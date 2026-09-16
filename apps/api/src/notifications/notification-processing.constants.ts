/**
 * Sprint 27.1 §Workstream A "Retry Behaviour" — every numeric policy value lives
 * here, not scattered through `NotificationEventProcessorService`. Deliberately
 * simple, matching the brief's own example almost verbatim: 3 total attempts,
 * immediate/1-minute/5-minute backoff, terminal `FAILED` after that.
 */

/** Total attempts (including the first) before an event becomes terminal `FAILED`
 *  and requires the admin retry endpoint. */
export const MAX_PROCESSING_ATTEMPTS = 3;

/** Indexed by `notificationAttempts` AFTER the failing attempt — i.e. the delay
 *  before the NEXT attempt. `RETRY_BACKOFF_MS[1]` is the delay before attempt 2,
 *  `RETRY_BACKOFF_MS[2]` before attempt 3. Attempt 1 is always immediate (a fresh
 *  `PENDING` event has no backoff at all). The last entry is reused if
 *  `MAX_PROCESSING_ATTEMPTS` is ever raised without extending this array. */
export const RETRY_BACKOFF_MS = [0, 60_000, 5 * 60_000];

/** How long a `PROCESSING` claim is honored before it's treated as an abandoned
 *  lease (the process that claimed it crashed or hung) and becomes reclaimable by
 *  the next sweep — notifications.md §4 "Stale-lease recovery." Generously larger
 *  than any realistic single-event processing time (a handful of DB queries). */
export const PROCESSING_LEASE_MS = 5 * 60 * 1000;

export function retryDelayForAttempt(attemptNumber: number): number {
  const index = Math.min(attemptNumber, RETRY_BACKOFF_MS.length - 1);
  return RETRY_BACKOFF_MS[index] ?? RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1] ?? 0;
}
