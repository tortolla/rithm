CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS schema_migrations (
  name text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id bigint NOT NULL UNIQUE,
  first_name text NOT NULL DEFAULT '',
  last_name text NOT NULL DEFAULT '',
  username text,
  language_code text NOT NULL DEFAULT 'ru',
  timezone text NOT NULL DEFAULT 'Europe/Moscow',
  notifications_enabled boolean NOT NULL DEFAULT true,
  evening_checkin_enabled boolean NOT NULL DEFAULT true,
  evening_checkin_time time NOT NULL DEFAULT '21:30',
  weekly_report_enabled boolean NOT NULL DEFAULT true,
  onboarding_completed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS directions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL,
  emoji text NOT NULL DEFAULT '•',
  color text NOT NULL DEFAULT '#8d1c13',
  active boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS habit_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  direction_id uuid NOT NULL REFERENCES directions(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  default_frequency text NOT NULL DEFAULT 'daily' CHECK (default_frequency IN ('daily', 'weekdays')),
  default_days smallint[] NOT NULL DEFAULT ARRAY[1,2,3,4,5,6,7]::smallint[],
  active boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  UNIQUE(direction_id, name)
);

CREATE TABLE IF NOT EXISTS sprints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text,
  start_date date NOT NULL,
  duration_days integer NOT NULL CHECK (duration_days IN (14, 21, 30)),
  end_date date GENERATED ALWAYS AS (start_date + duration_days - 1) STORED,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('planned', 'active', 'completed', 'stopped')),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS one_active_sprint_per_user
  ON sprints(user_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS sprint_habits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sprint_id uuid NOT NULL REFERENCES sprints(id) ON DELETE CASCADE,
  direction_id uuid REFERENCES directions(id) ON DELETE SET NULL,
  template_id uuid REFERENCES habit_templates(id) ON DELETE SET NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  schedule_days smallint[] NOT NULL DEFAULT ARRAY[1,2,3,4,5,6,7]::smallint[],
  reminder_enabled boolean NOT NULL DEFAULT true,
  reminder_time time NOT NULL DEFAULT '09:00',
  active boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS habit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sprint_habit_id uuid NOT NULL REFERENCES sprint_habits(id) ON DELETE CASCADE,
  scheduled_date date NOT NULL,
  effective_date date NOT NULL,
  due_at timestamptz,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'done', 'skipped', 'postponed')),
  completed_at timestamptz,
  source text NOT NULL DEFAULT 'app' CHECK (source IN ('app', 'bot', 'system')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(sprint_habit_id, scheduled_date)
);

CREATE INDEX IF NOT EXISTS habit_logs_effective_idx
  ON habit_logs(effective_date, state);

CREATE TABLE IF NOT EXISTS ideas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  direction_id uuid REFERENCES directions(id) ON DELETE SET NULL,
  template_id uuid REFERENCES habit_templates(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('support', 'reminder', 'weekly', 'completion')),
  text text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  UNIQUE(kind, text)
);

CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sprint_habit_id uuid REFERENCES sprint_habits(id) ON DELETE CASCADE,
  habit_log_id uuid REFERENCES habit_logs(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('reminder', 'rescheduled', 'evening', 'weekly', 'sprint_end')),
  local_date date NOT NULL,
  scheduled_at timestamptz NOT NULL,
  sent_at timestamptz,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'cancelled')),
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedupe_idx
  ON notifications(user_id, coalesce(sprint_habit_id, '00000000-0000-0000-0000-000000000000'::uuid), type, local_date);
