/**
 * Best-effort "Browser on OS" label from a raw `User-Agent` string (Sprint 3.3 §4 Active
 * Sessions "Browser" column). Deliberately simple regex matching, not a full UA-parsing
 * library — good enough to distinguish common browsers/platforms for display, not a
 * security or analytics signal.
 */
export function parseUserAgent(userAgent: string | null): string {
  if (!userAgent) {
    return 'Unknown device';
  }

  const browser = (() => {
    if (/Edg\//.test(userAgent)) return 'Edge';
    if (/OPR\//.test(userAgent)) return 'Opera';
    if (/Chrome\//.test(userAgent)) return 'Chrome';
    if (/Firefox\//.test(userAgent)) return 'Firefox';
    if (/Safari\//.test(userAgent) && !/Chrome\//.test(userAgent)) return 'Safari';
    return null;
  })();

  const os = (() => {
    if (/Windows/.test(userAgent)) return 'Windows';
    if (/Mac OS X/.test(userAgent)) return 'macOS';
    if (/Android/.test(userAgent)) return 'Android';
    if (/iPhone|iPad|iOS/.test(userAgent)) return 'iOS';
    if (/Linux/.test(userAgent)) return 'Linux';
    return null;
  })();

  if (browser && os) return `${browser} on ${os}`;
  if (browser) return browser;
  if (os) return `Unknown browser on ${os}`;
  // Non-browser clients (curl, scripts, API tools) — show a short version rather than
  // "Unknown device" so it's still distinguishable in the list.
  return userAgent.length > 40 ? `${userAgent.slice(0, 40)}…` : userAgent;
}
