/**
 * Sprint 28 §Workstream E "Email Processing Reliability" — a SEPARATE policy from
 * `notification-processing.constants.ts` (Sprint 27.1), per the brief's explicit
 * "do not reuse the in-app notification retry policy blindly if email provider
 * behaviour differs." It does differ here: an SMTP provider's transient failures
 * (rate limiting, greylisting, temporary connection issues) are more common and
 * often need longer to clear than an in-process DB hiccup, so this schedule is
 * longer than the in-app one (`[0, 60_000, 300_000]`) even though the shape
 * (3 attempts, immediate/short/long) is deliberately the same for consistency.
 */

/** Total attempts (including the first) before an email delivery becomes terminal
 *  `FAILED` and requires the admin retry endpoint. */
export const MAX_EMAIL_ATTEMPTS = 3;

/** Indexed by `attempts` AFTER the failing attempt — the delay before the NEXT
 *  attempt. Longer than the in-app notification processor's own backoff
 *  (`RETRY_BACKOFF_MS` in notification-processing.constants.ts) — see this file's
 *  own doc comment for why. */
export const EMAIL_RETRY_BACKOFF_MS = [0, 2 * 60_000, 10 * 60_000];

/** Same role as `PROCESSING_LEASE_MS` (Sprint 27.1) — how long a `PROCESSING`
 *  claim is honored before being treated as an abandoned lease (a crashed/hung
 *  processor) and reclaimed by the next sweep. Slightly longer than the in-app
 *  value since a real SMTP round-trip is slower than a handful of DB queries. */
export const EMAIL_PROCESSING_LEASE_MS = 10 * 60 * 1000;

export function emailRetryDelayForAttempt(attemptNumber: number): number {
  const index = Math.min(attemptNumber, EMAIL_RETRY_BACKOFF_MS.length - 1);
  return (
    EMAIL_RETRY_BACKOFF_MS[index] ?? EMAIL_RETRY_BACKOFF_MS[EMAIL_RETRY_BACKOFF_MS.length - 1] ?? 0
  );
}
