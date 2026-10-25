import { sql } from '../db/client.js';
import { addDays, localDate, weekday, zonedDateTimeToUtc } from '../lib/dates.js';

export async function ensureOccurrence(sprintHabitId: string, scheduledDate: string, source = 'system') {
  const [row] = await sql`
    INSERT INTO habit_logs (sprint_habit_id, scheduled_date, effective_date, source)
    VALUES (${sprintHabitId}, ${scheduledDate}, ${scheduledDate}, ${source})
    ON CONFLICT (sprint_habit_id, scheduled_date) DO UPDATE SET sprint_habit_id = EXCLUDED.sprint_habit_id
    RETURNING *
  `;
  return row;
}

export async function getCatalog() {
  const directions = await sql`
    SELECT id, slug, name, description, emoji, color
    FROM directions WHERE active = true ORDER BY display_order, name
  `;
  const templates = await sql`
    SELECT id, direction_id, name, description, default_frequency, default_days
    FROM habit_templates WHERE active = true ORDER BY display_order, name
  `;
  return directions.map((direction) => ({
    ...direction,
    habits: templates.filter((template) => template.directionId === direction.id)
  }));
}

export async function getActiveSprint(userId: string, timezone: string) {
  const [sprint] = await sql`
    SELECT id, user_id, name, to_char(start_date, 'YYYY-MM-DD') AS start_date,
      duration_days, to_char(end_date, 'YYYY-MM-DD') AS end_date, status, created_at, completed_at
    FROM sprints WHERE user_id = ${userId} AND status = 'active' LIMIT 1
  `;
  if (!sprint) return null;
  const habits = await sql`
    SELECT sh.*, d.name AS direction_name, d.emoji, d.color
    FROM sprint_habits sh
    LEFT JOIN directions d ON d.id = sh.direction_id
    WHERE sh.sprint_id = ${sprint.id} AND sh.active = true
    ORDER BY sh.display_order
  `;
  const today = localDate(timezone);
  const todayWeekday = weekday(today);

  for (const habit of habits) {
    for (let offset = 0; offset < sprint.durationDays; offset += 1) {
      const date = addDays(sprint.startDate, offset);
      if (date > today || date > sprint.endDate) break;
      if (habit.scheduleDays.includes(weekday(date))) await ensureOccurrence(habit.id, date);
    }
    if (habit.scheduleDays.includes(todayWeekday) && today >= sprint.startDate && today <= sprint.endDate) {
      await ensureOccurrence(habit.id, today);
    }
  }

  const logs = await sql`
    SELECT hl.id, hl.sprint_habit_id, to_char(hl.scheduled_date, 'YYYY-MM-DD') AS scheduled_date,
      to_char(hl.effective_date, 'YYYY-MM-DD') AS effective_date, hl.due_at, hl.state,
      hl.completed_at, hl.source, hl.created_at, hl.updated_at
    FROM habit_logs hl
    JOIN sprint_habits sh ON sh.id = hl.sprint_habit_id
    WHERE sh.sprint_id = ${sprint.id}
      AND (hl.effective_date = ${today} OR hl.scheduled_date = ${today})
  `;
  const todayHabits = habits
    .map((habit) => {
      const log = logs.find((item) => item.sprintHabitId === habit.id && item.effectiveDate === today);
      return log ? { ...habit, log } : null;
    })
    .filter(Boolean);

  const [totals] = await sql`
    SELECT
      count(*) FILTER (WHERE hl.state IN ('done', 'skipped', 'postponed', 'pending'))::int AS planned,
      count(*) FILTER (WHERE hl.state = 'done')::int AS done
    FROM habit_logs hl
    JOIN sprint_habits sh ON sh.id = hl.sprint_habit_id
    WHERE sh.sprint_id = ${sprint.id} AND hl.scheduled_date <= ${today}
  `;
  return { ...sprint, habits, todayHabits, today, totals };
}

export async function getStats(userId: string, timezone: string) {
  const [sprint] = await sql`
    SELECT id, user_id, name, to_char(start_date, 'YYYY-MM-DD') AS start_date,
      duration_days, to_char(end_date, 'YYYY-MM-DD') AS end_date, status
    FROM sprints WHERE user_id = ${userId} AND status = 'active' LIMIT 1
  `;
  if (!sprint) return null;
  const today = localDate(timezone);
  const rows = await sql`
    SELECT sh.id, sh.name,
      count(hl.id) FILTER (WHERE hl.scheduled_date <= ${today})::int AS planned,
      count(hl.id) FILTER (WHERE hl.state = 'done')::int AS done,
      json_agg(json_build_object('date', to_char(hl.scheduled_date, 'YYYY-MM-DD'), 'state', hl.state) ORDER BY hl.scheduled_date)
        FILTER (WHERE hl.id IS NOT NULL) AS logs
    FROM sprint_habits sh
    LEFT JOIN habit_logs hl ON hl.sprint_habit_id = sh.id
    WHERE sh.sprint_id = ${sprint.id}
    GROUP BY sh.id, sh.name, sh.display_order
    ORDER BY sh.display_order
  `;
  const planned = rows.reduce((sum, row) => sum + row.planned, 0);
  const done = rows.reduce((sum, row) => sum + row.done, 0);
  return { sprint, habits: rows, totals: { planned, done, percent: planned ? Math.round(done * 100 / planned) : 0 } };
}

export async function actOnHabit(input: {
  userId: string;
  sprintHabitId: string;
  scheduledDate: string;
  action: 'done' | 'skip' | 'postponeToday' | 'postponeTomorrow';
  source: 'app' | 'bot';
  timezone: string;
}) {
  const [owned] = await sql`
    SELECT sh.id, sh.reminder_time FROM sprint_habits sh
    JOIN sprints s ON s.id = sh.sprint_id
    WHERE sh.id = ${input.sprintHabitId} AND s.user_id = ${input.userId} AND s.status = 'active'
  `;
  if (!owned) throw new Error('Привычка не найдена');
  const today = localDate(input.timezone);
  if (input.scheduledDate > today) throw new Error('Нельзя изменить будущее выполнение');
  await ensureOccurrence(input.sprintHabitId, input.scheduledDate, input.source);

  const state = input.action === 'done' ? 'done' : input.action === 'skip' ? 'skipped' : 'postponed';
  const effectiveDate = input.action === 'postponeTomorrow' ? addDays(today, 1) : today;
  const dueAt = input.action === 'postponeToday'
    ? new Date(Date.now() + 2 * 60 * 60 * 1000)
    : input.action === 'postponeTomorrow'
      ? zonedDateTimeToUtc(effectiveDate, String(owned.reminderTime).slice(0, 5), input.timezone)
      : null;
  const [updated] = await sql`
    UPDATE habit_logs SET
      state = ${state},
      effective_date = ${effectiveDate},
      due_at = ${dueAt},
      completed_at = ${state === 'done' ? new Date() : null},
      source = ${input.source},
      updated_at = now()
    WHERE sprint_habit_id = ${input.sprintHabitId} AND scheduled_date = ${input.scheduledDate}
    RETURNING *
  `;
  return updated;
}
