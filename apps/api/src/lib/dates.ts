export type LocalParts = { date: string; time: string; weekday: number; hour: number; minute: number };

export function localParts(date: Date, timeZone: string): LocalParts {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short'
  });
  const values = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  const weekdays: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}`,
    weekday: weekdays[values.weekday],
    hour: Number(values.hour),
    minute: Number(values.minute)
  };
}

export function localDate(timeZone: string, date = new Date()) {
  return localParts(date, timeZone).date;
}

export function addDays(isoDate: string, amount: number) {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

export function weekday(isoDate: string) {
  const day = new Date(`${isoDate}T12:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

export function zonedDateTimeToUtc(isoDate: string, hhmm: string, timeZone: string) {
  const desired = new Date(`${isoDate}T${hhmm.slice(0, 5)}:00Z`);
  let candidate = new Date(desired);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = localParts(candidate, timeZone);
    const actual = new Date(`${parts.date}T${parts.time}:00Z`);
    const delta = desired.getTime() - actual.getTime();
    if (delta === 0) break;
    candidate = new Date(candidate.getTime() + delta);
  }
  return candidate;
}
