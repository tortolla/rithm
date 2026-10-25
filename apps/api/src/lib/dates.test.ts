import { describe, expect, it } from 'vitest';
import { addDays, localParts, weekday, zonedDateTimeToUtc } from './dates.js';

describe('date helpers', () => {
  it('calculates ISO weekdays and day transitions', () => {
    expect(weekday('2026-10-25')).toBe(7);
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26');
  });

  it('converts Moscow local time to UTC', () => {
    expect(zonedDateTimeToUtc('2026-10-25', '21:00', 'Europe/Moscow').toISOString()).toBe('2026-10-25T18:00:00.000Z');
  });

  it('reads user-local date instead of server-local date', () => {
    const parts = localParts(new Date('2026-10-25T22:30:00Z'), 'Europe/Moscow');
    expect(parts).toMatchObject({ date: '2026-10-26', time: '01:30', weekday: 1 });
  });
});
