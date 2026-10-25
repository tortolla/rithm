import { sql } from '../db/client.js';
import { localParts, weekday } from '../lib/dates.js';
import { ensureOccurrence } from '../services/data.js';
import { sendEveningCheckin, sendHabitReminder, sendWeeklyReport, type RithmBot } from './bot.js';

type NotificationType = 'reminder' | 'rescheduled' | 'evening' | 'weekly' | 'sprint_end';

async function claimNotification(input: {
  userId: string;
  sprintHabitId?: string;
  habitLogId?: string;
  type: NotificationType;
  localDate: string;
}) {
  const rows = await sql`
    INSERT INTO notifications (user_id, sprint_habit_id, habit_log_id, type, local_date, scheduled_at)
    VALUES (${input.userId}, ${input.sprintHabitId ?? null}, ${input.habitLogId ?? null}, ${input.type}, ${input.localDate}, now())
    ON CONFLICT DO NOTHING
    RETURNING id
  `;
  return rows[0]?.id as string | undefined;
}

async function markNotification(id: string, status: 'sent' | 'failed', error?: unknown) {
  await sql`
    UPDATE notifications SET status = ${status}, sent_at = ${status === 'sent' ? new Date() : null},
      error = ${error ? String(error).slice(0, 1000) : null}
    WHERE id = ${id}
  `;
}

async function sweep(bot: RithmBot) {
  const users = await sql`
    SELECT u.id, u.telegram_id, u.timezone, u.notifications_enabled,
      u.evening_checkin_enabled, u.evening_checkin_time, u.weekly_report_enabled,
      s.id AS sprint_id, to_char(s.end_date, 'YYYY-MM-DD') AS end_date
    FROM users u JOIN sprints s ON s.user_id = u.id AND s.status = 'active'
  `;
  const now = new Date();

  for (const user of users) {
    const local = localParts(now, user.timezone);
    try {
      if (user.notificationsEnabled) {
        const habits = await sql`
          SELECT * FROM sprint_habits
          WHERE sprint_id = ${user.sprintId} AND active = true AND reminder_enabled = true
        `;
        for (const habit of habits) {
          if (!habit.scheduleDays.includes(weekday(local.date)) || String(habit.reminderTime).slice(0, 5) !== local.time) continue;
          const log = await ensureOccurrence(habit.id, local.date);
          if (log.state !== 'pending') continue;
          const notificationId = await claimNotification({
            userId: user.id, sprintHabitId: habit.id, habitLogId: log.id, type: 'reminder', localDate: local.date
          });
          if (!notificationId) continue;
          try {
            await sendHabitReminder(bot, {
              telegramId: Number(user.telegramId), habitId: habit.id, scheduledDate: local.date,
              habitName: habit.name, description: habit.description, reminderTime: String(habit.reminderTime)
            });
            await markNotification(notificationId, 'sent');
          } catch (error) {
            await markNotification(notificationId, 'failed', error);
          }
        }

        const postponed = await sql`
          SELECT hl.id, hl.sprint_habit_id, to_char(hl.scheduled_date, 'YYYY-MM-DD') AS scheduled_date,
            to_char(hl.effective_date, 'YYYY-MM-DD') AS effective_date, hl.state, hl.due_at,
            sh.name, sh.description, sh.reminder_time
          FROM habit_logs hl
          JOIN sprint_habits sh ON sh.id = hl.sprint_habit_id
          WHERE sh.sprint_id = ${user.sprintId} AND hl.state = 'postponed'
            AND hl.due_at IS NOT NULL AND hl.due_at <= now()
        `;
        for (const log of postponed) {
          const notificationId = await claimNotification({
            userId: user.id, sprintHabitId: log.sprintHabitId, habitLogId: log.id,
            type: 'rescheduled', localDate: log.effectiveDate
          });
          if (!notificationId) continue;
          try {
            await sendHabitReminder(bot, {
              telegramId: Number(user.telegramId), habitId: log.sprintHabitId, scheduledDate: log.scheduledDate,
              habitName: log.name, description: log.description, reminderTime: local.time
            });
            await markNotification(notificationId, 'sent');
          } catch (error) {
            await markNotification(notificationId, 'failed', error);
          }
        }
      }

      if (user.eveningCheckinEnabled && String(user.eveningCheckinTime).slice(0, 5) === local.time) {
        const id = await claimNotification({ userId: user.id, type: 'evening', localDate: local.date });
        if (id) {
          try {
            await sendEveningCheckin(bot, Number(user.telegramId), user.id, user.timezone);
            await markNotification(id, 'sent');
          } catch (error) { await markNotification(id, 'failed', error); }
        }
      }

      if (user.weeklyReportEnabled && local.weekday === 7 && local.time === '20:00') {
        const id = await claimNotification({ userId: user.id, type: 'weekly', localDate: local.date });
        if (id) {
          try {
            await sendWeeklyReport(bot, Number(user.telegramId), user.id, user.timezone);
            await markNotification(id, 'sent');
          } catch (error) { await markNotification(id, 'failed', error); }
        }
      }

      if (user.endDate === local.date && local.time === '20:30') {
        const id = await claimNotification({ userId: user.id, type: 'sprint_end', localDate: local.date });
        if (id) {
          try {
            await bot.api.sendMessage(Number(user.telegramId), 'Ты прошла свой спринт ✨\n\nЭто не экзамен, а момент посмотреть, что получилось и что хочется взять с собой дальше.', {
              reply_markup: { inline_keyboard: [[{ text: 'Посмотреть итоги', web_app: { url: process.env.PUBLIC_APP_URL! } }]] }
            });
            await markNotification(id, 'sent');
          } catch (error) { await markNotification(id, 'failed', error); }
        }
      }
    } catch (error) {
      console.error(`Scheduler error for user ${user.id}`, error);
    }
  }
}

export function startScheduler(bot: RithmBot) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try { await sweep(bot); } finally { running = false; }
  };
  void run();
  const timer = setInterval(run, 30_000);
  return () => clearInterval(timer);
}
