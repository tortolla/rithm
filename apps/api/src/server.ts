import './types.js';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import staticPlugin from '@fastify/static';
import { z } from 'zod';
import { config } from './config.js';
import { sql } from './db/client.js';
import { migrate } from './db/migrate.js';
import { seed } from './db/seed.js';
import { validateInitData, type TelegramUser } from './lib/telegramAuth.js';
import { localDate } from './lib/dates.js';
import { actOnHabit, getActiveSprint, getCatalog, getStats } from './services/data.js';
import { startBot } from './telegram/bot.js';
import { startScheduler } from './telegram/scheduler.js';

const app = Fastify({ logger: true, trustProxy: true });
await app.register(cors, { origin: config.NODE_ENV === 'development' });

const webRoot = resolve(process.cwd(), 'dist/web');
if (existsSync(webRoot)) {
  await app.register(staticPlugin, { root: webRoot, wildcard: false });
}

app.get('/api/health', async () => {
  await sql`SELECT 1`;
  return { ok: true, service: 'rithm', time: new Date().toISOString() };
});

app.addHook('preHandler', async (request, reply) => {
  if (!request.url.startsWith('/api/') || request.url === '/api/health') return;
  let telegram: TelegramUser;
  const initData = request.headers['x-telegram-init-data'];
  if (typeof initData === 'string' && config.BOT_TOKEN) {
    try {
      telegram = validateInitData(initData, config.BOT_TOKEN);
    } catch (error) {
      return reply.code(401).send({ error: error instanceof Error ? error.message : 'Ошибка авторизации' });
    }
  } else if (config.NODE_ENV !== 'production') {
    const devId = Number(request.headers['x-dev-telegram-id'] ?? config.DEV_TELEGRAM_ID);
    telegram = { id: devId, first_name: config.DEV_TELEGRAM_NAME, language_code: 'ru' };
  } else {
    return reply.code(401).send({ error: 'Откройте РИТМ внутри Telegram' });
  }

  const [user] = await sql`
    INSERT INTO users (telegram_id, first_name, last_name, username, language_code)
    VALUES (${telegram.id}, ${telegram.first_name}, ${telegram.last_name ?? ''}, ${telegram.username ?? null}, ${telegram.language_code ?? 'ru'})
    ON CONFLICT (telegram_id) DO UPDATE SET
      first_name = EXCLUDED.first_name,
      last_name = EXCLUDED.last_name,
      username = EXCLUDED.username,
      language_code = EXCLUDED.language_code,
      updated_at = now()
    RETURNING id, telegram_id, first_name, timezone, onboarding_completed
  `;
  request.appUser = {
    id: String(user.id),
    telegramId: Number(user.telegramId),
    firstName: String(user.firstName),
    timezone: String(user.timezone),
    onboardingCompleted: Boolean(user.onboardingCompleted),
    telegram
  };
});

app.get('/api/bootstrap', async (request) => {
  const [catalog, sprint, ideas, quote] = await Promise.all([
    getCatalog(),
    getActiveSprint(request.appUser.id, request.appUser.timezone),
    sql`SELECT * FROM ideas WHERE user_id = ${request.appUser.id} ORDER BY created_at DESC`,
    sql`SELECT text FROM messages WHERE kind = 'support' AND active = true ORDER BY random() LIMIT 1`
  ]);
  return {
    user: {
      firstName: request.appUser.firstName,
      timezone: request.appUser.timezone,
      onboardingCompleted: request.appUser.onboardingCompleted
    },
    catalog,
    sprint,
    ideas,
    quote: quote[0]?.text ?? 'Маленький шаг — тоже движение.'
  };
});

const settingsSchema = z.object({
  timezone: z.string().min(1).max(80).optional(),
  notificationsEnabled: z.boolean().optional(),
  eveningCheckinEnabled: z.boolean().optional(),
  weeklyReportEnabled: z.boolean().optional()
});

app.patch('/api/settings', async (request, reply) => {
  const parsed = settingsSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'Некорректные настройки' });
  const current = await sql`SELECT * FROM users WHERE id = ${request.appUser.id}`;
  const value = parsed.data;
  const [updated] = await sql`
    UPDATE users SET
      timezone = ${value.timezone ?? current[0].timezone},
      notifications_enabled = ${value.notificationsEnabled ?? current[0].notificationsEnabled},
      evening_checkin_enabled = ${value.eveningCheckinEnabled ?? current[0].eveningCheckinEnabled},
      weekly_report_enabled = ${value.weeklyReportEnabled ?? current[0].weeklyReportEnabled},
      updated_at = now()
    WHERE id = ${request.appUser.id}
    RETURNING timezone, notifications_enabled, evening_checkin_enabled, weekly_report_enabled
  `;
  return updated;
});

const sprintSchema = z.object({
  name: z.string().trim().max(80).optional(),
  durationDays: z.union([z.literal(14), z.literal(21), z.literal(30)]),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  habits: z.array(z.object({
    directionId: z.string().uuid(),
    templateId: z.string().uuid().nullable().optional(),
    name: z.string().trim().min(2).max(100),
    description: z.string().trim().max(300).default(''),
    scheduleDays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
    reminderEnabled: z.boolean().default(true),
    reminderTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
  })).min(1).max(3)
});

app.post('/api/sprints', async (request, reply) => {
  const parsed = sprintSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'Проверьте параметры спринта', details: parsed.error.flatten() });
  const input = parsed.data;
  if (new Set(input.habits.map((habit) => habit.directionId)).size !== input.habits.length) {
    return reply.code(400).send({ error: 'Для первого спринта выберите по одной привычке на направление' });
  }
  const existing = await sql`SELECT id FROM sprints WHERE user_id = ${request.appUser.id} AND status = 'active'`;
  if (existing.length) return reply.code(409).send({ error: 'Сначала завершите текущий спринт' });

  const sprint = await sql.begin(async (tx) => {
    const [created] = await tx`
      INSERT INTO sprints (user_id, name, start_date, duration_days, status)
      VALUES (${request.appUser.id}, ${input.name || null}, ${input.startDate}, ${input.durationDays}, 'active')
      RETURNING *
    `;
    for (const [index, habit] of input.habits.entries()) {
      await tx`
        INSERT INTO sprint_habits (
          sprint_id, direction_id, template_id, name, description, schedule_days,
          reminder_enabled, reminder_time, display_order
        ) VALUES (
          ${created.id}, ${habit.directionId}, ${habit.templateId ?? null}, ${habit.name}, ${habit.description},
          ${tx.array([...new Set(habit.scheduleDays)].sort(), 21)}, ${habit.reminderEnabled}, ${habit.reminderTime}, ${index}
        )
      `;
    }
    await tx`UPDATE users SET onboarding_completed = true, updated_at = now() WHERE id = ${request.appUser.id}`;
    return created;
  });
  return reply.code(201).send(sprint);
});

const actionSchema = z.object({
  action: z.enum(['done', 'skip', 'postponeToday', 'postponeTomorrow']),
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
});

app.post('/api/habits/:id/action', async (request, reply) => {
  const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
  const body = actionSchema.safeParse(request.body);
  if (!params.success || !body.success) return reply.code(400).send({ error: 'Некорректное действие' });
  try {
    const log = await actOnHabit({
      userId: request.appUser.id,
      sprintHabitId: params.data.id,
      scheduledDate: body.data.scheduledDate,
      action: body.data.action,
      source: 'app',
      timezone: request.appUser.timezone
    });
    const [quote] = await sql`SELECT text FROM messages WHERE kind = 'support' AND active = true ORDER BY random() LIMIT 1`;
    return { log, quote: body.data.action === 'done' ? quote?.text : null };
  } catch (error) {
    return reply.code(400).send({ error: error instanceof Error ? error.message : 'Не удалось сохранить отметку' });
  }
});

app.get('/api/stats', async (request) => getStats(request.appUser.id, request.appUser.timezone));

const ideaSchema = z.object({
  title: z.string().trim().min(2).max(100),
  description: z.string().trim().max(300).default(''),
  directionId: z.string().uuid().nullable().optional(),
  templateId: z.string().uuid().nullable().optional()
});

app.post('/api/ideas', async (request, reply) => {
  const parsed = ideaSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'Введите название идеи' });
  const [idea] = await sql`
    INSERT INTO ideas (user_id, title, description, direction_id, template_id)
    VALUES (${request.appUser.id}, ${parsed.data.title}, ${parsed.data.description}, ${parsed.data.directionId ?? null}, ${parsed.data.templateId ?? null})
    RETURNING *
  `;
  return reply.code(201).send(idea);
});

app.patch('/api/ideas/:id', async (request, reply) => {
  const id = z.object({ id: z.string().uuid() }).safeParse(request.params);
  const body = ideaSchema.safeParse(request.body);
  if (!id.success || !body.success) return reply.code(400).send({ error: 'Некорректная идея' });
  const [idea] = await sql`
    UPDATE ideas SET title = ${body.data.title}, description = ${body.data.description},
      direction_id = ${body.data.directionId ?? null}, updated_at = now()
    WHERE id = ${id.data.id} AND user_id = ${request.appUser.id}
    RETURNING *
  `;
  if (!idea) return reply.code(404).send({ error: 'Идея не найдена' });
  return idea;
});

app.delete('/api/ideas/:id', async (request, reply) => {
  const id = z.object({ id: z.string().uuid() }).safeParse(request.params);
  if (!id.success) return reply.code(400).send({ error: 'Некорректная идея' });
  const deleted = await sql`DELETE FROM ideas WHERE id = ${id.data.id} AND user_id = ${request.appUser.id} RETURNING id`;
  if (!deleted.length) return reply.code(404).send({ error: 'Идея не найдена' });
  return reply.code(204).send();
});

app.post('/api/sprints/current/complete', async (request, reply) => {
  const stats = await getStats(request.appUser.id, request.appUser.timezone);
  const [sprint] = await sql`
    UPDATE sprints SET status = 'completed', completed_at = now()
    WHERE user_id = ${request.appUser.id} AND status = 'active'
    RETURNING *
  `;
  if (!sprint) return reply.code(404).send({ error: 'Активный спринт не найден' });
  return { sprint, stats };
});

if (existsSync(webRoot)) {
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/')) return reply.code(404).send({ error: 'Не найдено' });
    return reply.sendFile('index.html');
  });
}

async function main() {
  await migrate();
  await seed();
  const bot = config.BOT_TOKEN ? startBot() : null;
  const stopScheduler = config.SCHEDULER_ENABLED === 'true' && bot ? startScheduler(bot) : () => undefined;
  const close = async () => {
    stopScheduler();
    await bot?.stop();
    await app.close();
    await sql.end();
  };
  process.on('SIGTERM', close);
  process.on('SIGINT', close);
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
}

main().catch((error) => {
  app.log.error(error);
  process.exit(1);
});
