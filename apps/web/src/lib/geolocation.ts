export interface Coordinates {
  latitude: number;
  longitude: number;
}

/**
 * One-shot browser geolocation capture (Sprint 4.8, Outlet onboarding). Resolves `null`
 * on denial, unavailability, or timeout — it never rejects, because coordinates are
 * always optional (docs/domains/outlets.md: "Do not require GPS during onboarding").
 *
 * Deliberately uses `getCurrentPosition`, never `watchPosition` — there is no continuous
 * location tracking anywhere in this codebase, and none is planned this sprint.
 */
export function captureCoordinates(timeoutMs = 10_000): Promise<Coordinates | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude });
      },
      () => resolve(null),
      { timeout: timeoutMs, enableHighAccuracy: false },
    );
  });
}
