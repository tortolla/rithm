export type HabitTemplate = {
  id: string;
  directionId: string;
  name: string;
  description: string;
  defaultFrequency: 'daily' | 'weekdays';
  defaultDays: number[];
};

export type Direction = {
  id: string;
  slug: string;
  name: string;
  description: string;
  emoji: string;
  color: string;
  habits: HabitTemplate[];
};

export type HabitLog = {
  id: string;
  scheduledDate: string;
  effectiveDate: string;
  state: 'pending' | 'done' | 'skipped' | 'postponed';
};

export type SprintHabit = {
  id: string;
  name: string;
  description: string;
  directionId: string;
  directionName: string;
  emoji: string;
  color: string;
  scheduleDays: number[];
  reminderEnabled: boolean;
  reminderTime: string;
  log?: HabitLog;
};

export type Sprint = {
  id: string;
  name?: string;
  startDate: string;
  endDate: string;
  durationDays: number;
  habits: SprintHabit[];
  todayHabits: SprintHabit[];
  today: string;
  totals: { planned: number; done: number };
};

export type Idea = { id: string; title: string; description: string; directionId?: string };

export type Bootstrap = {
  user: { firstName: string; timezone: string; onboardingCompleted: boolean };
  catalog: Direction[];
  sprint: Sprint | null;
  ideas: Idea[];
  quote: string;
};

export type Stats = {
  sprint: Sprint;
  habits: Array<{ id: string; name: string; planned: number; done: number; logs: Array<{ date: string; state: string }> | null }>;
  totals: { planned: number; done: number; percent: number };
};
