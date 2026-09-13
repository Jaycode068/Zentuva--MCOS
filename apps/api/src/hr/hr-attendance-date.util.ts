/**
 * Sprint 24 — derives an attendance "business date" (a day-bucket, not a
 * real moment) from a server-authoritative UTC timestamp and the
 * organisation's configured `timeZone` (Organisation.timeZone, previously
 * stored but never consumed for date-bucketing anywhere in this codebase).
 *
 * Returns a `Date` set to UTC midnight for the organisation-local calendar
 * date, so it round-trips cleanly through Prisma's `DateTime` column and
 * compares correctly across attendance records.
 */
export function resolveAttendanceDate(instant: Date, timeZone: string): Date {
  const localDateString = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
  return new Date(`${localDateString}T00:00:00.000Z`);
}

export function isFutureAttendanceDate(attendanceDate: Date, now: Date, timeZone: string): boolean {
  const todayBucket = resolveAttendanceDate(now, timeZone);
  return attendanceDate.getTime() > todayBucket.getTime();
}
