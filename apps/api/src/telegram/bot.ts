import { Bot, InlineKeyboard } from 'grammy';
import { config } from '../config.js';
import { sql } from '../db/client.js';
import { localDate } from '../lib/dates.js';
import { actOnHabit } from '../services/data.js';

export type RithmBot = Bot;

const welcome = `Привет, я Настя Сычёва.

Я верю, что большие перемены начинаются с маленьких шагов. Чтобы не потеряться в куче целей и отслеживать прогресс, я придумала РИТМ — приложение, которое сначала создала для себя, чтобы двигаться к изменениям без перегруза и постоянного чувства, что я что-то не успеваю.

Теперь хочу поделиться им с тобой.`;

export function startBot() {
  if (!config.BOT_TOKEN) throw new Error('BOT_TOKEN не задан');
  const bot = new Bot(config.BOT_TOKEN);

  bot.command('start', async (ctx) => {
    const keyboard = new InlineKeyboard().webApp('Открыть РИТМ', config.PUBLIC_APP_URL);
    await ctx.reply(welcome, { reply_markup: keyboard });
  });

  bot.command('ritm', async (ctx) => {
    await ctx.reply('Твой РИТМ всегда рядом.', {
      reply_markup: new InlineKeyboard().webApp('Открыть приложение', config.PUBLIC_APP_URL)
    });
  });

  bot.callbackQuery(/^habit:(done|skip|today|tomorrow):([0-9a-f-]{36}):(\d{4}-\d{2}-\d{2})$/, async (ctx) => {
    const [, rawAction, sprintHabitId, scheduledDate] = ctx.match;
    const [user] = await sql`
      SELECT id, timezone FROM users WHERE telegram_id = ${ctx.from.id}
    `;
    if (!user) {
      await ctx.answerCallbackQuery({ text: 'Сначала открой РИТМ и создай спринт.' });
      return;
    }
    const actionMap = {
      done: 'done', skip: 'skip', today: 'postponeToday', tomorrow: 'postponeTomorrow'
    } as const;
    try {
      await actOnHabit({
        userId: user.id,
        sprintHabitId,
        scheduledDate,
        action: actionMap[rawAction as keyof typeof actionMap],
        source: 'bot',
        timezone: user.timezone
      });
      if (rawAction === 'done') {
        const [message] = await sql`SELECT text FROM messages WHERE kind = 'support' AND active = true ORDER BY random() LIMIT 1`;
        await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() });
        await ctx.reply(`✓ Ещё один шаг сделан\n\n${message?.text ?? 'Маленький шаг — тоже движение.'}`);
      } else if (rawAction === 'skip') {
        await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() });
        await ctx.reply('Хорошо, сегодня оставим так. Один пропуск не отменяет твоих усилий.');
      } else {
        await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() });
        await ctx.reply(rawAction === 'today' ? 'Напомню ещё раз через два часа.' : 'Перенесла на завтра.');
      }
      await ctx.answerCallbackQuery();
    } catch (error) {
      await ctx.answerCallbackQuery({ text: error instanceof Error ? error.message : 'Не удалось сохранить' });
    }
  });

  bot.catch((error) => console.error('Telegram bot error', error.error));
  void bot.start({
    allowed_updates: ['message', 'callback_query'],
    onStart: (info) => console.log(`Telegram bot @${info.username} started`)
  });
  return bot;
}

export function habitKeyboard(habitId: string, scheduledDate: string) {
  return new InlineKeyboard()
    .text('✓ Сделано', `habit:done:${habitId}:${scheduledDate}`)
    .row()
    .text('Сегодня позже', `habit:today:${habitId}:${scheduledDate}`)
    .text('На завтра', `habit:tomorrow:${habitId}:${scheduledDate}`)
    .row()
    .text('Не сегодня', `habit:skip:${habitId}:${scheduledDate}`);
}

export async function sendHabitReminder(bot: RithmBot, input: {
  telegramId: number; habitId: string; scheduledDate: string; habitName: string; description?: string; reminderTime: string;
}) {
  const text = `РИТМ · ${input.reminderTime.slice(0, 5)}\n\nТвоё маленькое действие на сегодня\n\n${input.habitName}${input.description ? `\n${input.description}` : ''}\n\nНе нужно ждать идеального момента. Достаточно начать.`;
  return bot.api.sendMessage(input.telegramId, text, { reply_markup: habitKeyboard(input.habitId, input.scheduledDate) });
}

export async function sendEveningCheckin(bot: RithmBot, telegramId: number, userId: string, timezone: string) {
  const today = localDate(timezone);
  const habits = await sql`
    SELECT sh.name, hl.state FROM habit_logs hl
    JOIN sprint_habits sh ON sh.id = hl.sprint_habit_id
    JOIN sprints s ON s.id = sh.sprint_id
    WHERE s.user_id = ${userId} AND s.status = 'active' AND hl.effective_date = ${today}
    ORDER BY sh.display_order
  `;
  if (!habits.length || habits.every((habit) => habit.state === 'done')) return;
  const lines = habits.map((habit) => `${habit.state === 'done' ? '✓' : '○'} ${habit.name}`).join('\n');
  await bot.api.sendMessage(telegramId, `Как прошёл день? 🌙\n\n${lines}\n\nПодробности и отметки — в приложении.`, {
    reply_markup: new InlineKeyboard().webApp('Подвести итоги', config.PUBLIC_APP_URL)
  });
}

export async function sendWeeklyReport(bot: RithmBot, telegramId: number, userId: string, timezone: string) {
  const today = localDate(timezone);
  const [summary] = await sql`
    SELECT count(*)::int AS planned,
      count(*) FILTER (WHERE hl.state = 'done')::int AS done
    FROM habit_logs hl
    JOIN sprint_habits sh ON sh.id = hl.sprint_habit_id
    JOIN sprints s ON s.id = sh.sprint_id
    WHERE s.user_id = ${userId} AND s.status = 'active'
      AND hl.scheduled_date BETWEEN (${today}::date - 6) AND ${today}::date
  `;
  if (!summary?.planned) return;
  const percent = Math.round(summary.done * 100 / summary.planned);
  await bot.api.sendMessage(telegramId, `Твоя неделя в ритме 🌿\n\nВыполнено ${summary.done} из ${summary.planned} запланированных действий — ${percent}%.\n\nПосмотри, что помогало тебе держать ритм, а что можно сделать проще.`, {
    reply_markup: new InlineKeyboard().webApp('Открыть статистику', config.PUBLIC_APP_URL)
  });
}
