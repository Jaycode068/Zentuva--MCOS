import { isFutureAttendanceDate, resolveAttendanceDate } from './hr-attendance-date.util';

describe('resolveAttendanceDate', () => {
  it('buckets a UTC instant to the same calendar date when timeZone is UTC', () => {
    const instant = new Date('2026-03-05T23:30:00.000Z');
    const bucket = resolveAttendanceDate(instant, 'UTC');
    expect(bucket.toISOString()).toBe('2026-03-05T00:00:00.000Z');
  });

  it('rolls the date forward for a timezone ahead of UTC', () => {
    // 23:30 UTC is already 08:30 the next day in Africa/Lagos (+1) — actually
    // Lagos is UTC+1, so 23:30 UTC -> 00:30 local, still rolls the date.
    const instant = new Date('2026-03-05T23:30:00.000Z');
    const bucket = resolveAttendanceDate(instant, 'Africa/Lagos');
    expect(bucket.toISOString()).toBe('2026-03-06T00:00:00.000Z');
  });

  it('keeps the date back for a timezone behind UTC', () => {
    // 02:00 UTC is still the previous day (21:00) in America/New_York (-5).
    const instant = new Date('2026-03-06T02:00:00.000Z');
    const bucket = resolveAttendanceDate(instant, 'America/New_York');
    expect(bucket.toISOString()).toBe('2026-03-05T00:00:00.000Z');
  });
});

describe('isFutureAttendanceDate', () => {
  it('is false for today’s bucket', () => {
    const now = new Date('2026-03-05T12:00:00.000Z');
    const today = resolveAttendanceDate(now, 'UTC');
    expect(isFutureAttendanceDate(today, now, 'UTC')).toBe(false);
  });

  it('is true for a date after today', () => {
    const now = new Date('2026-03-05T12:00:00.000Z');
    const tomorrow = new Date('2026-03-06T00:00:00.000Z');
    expect(isFutureAttendanceDate(tomorrow, now, 'UTC')).toBe(true);
  });

  it('is false for a date before today', () => {
    const now = new Date('2026-03-05T12:00:00.000Z');
    const yesterday = new Date('2026-03-04T00:00:00.000Z');
    expect(isFutureAttendanceDate(yesterday, now, 'UTC')).toBe(false);
  });
});
