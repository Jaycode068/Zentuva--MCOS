import { env } from './env';

const ACCESS_TOKEN_STORAGE_KEY = 'zentuva_access_token';
const REFRESH_TOKEN_STORAGE_KEY = 'zentuva_refresh_token';

/** Reads the bearer access token. Checks localStorage first, then sessionStorage — which
 *  one holds it depends on whether the login page's Remember Me was checked (Sprint 3.3),
 *  see {@link setTokens}. Set by the login page (Sprint 3.2) — before that, no page
 *  actually wrote it, so this always returned `null`; see
 *  docs/sprint-2.1-completion-report.md "Known limitations" for that history. */
export function getAccessToken(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return (
    window.localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY) ??
    window.sessionStorage.getItem(ACCESS_TOKEN_STORAGE_KEY)
  );
}

/**
 * Persists both tokens after a successful login (Sprint 3.2). `refreshToken` is stored
 * for future use — nothing reads it yet, `apiFetch` below only ever sends the access
 * token; there is no refresh-on-401 flow in this sprint.
 *
 * `remember` (Sprint 3.3 "Remember Me" checkbox, default `true` to preserve every
 * existing caller's behavior): `true` persists to localStorage (survives closing the
 * browser); `false` uses sessionStorage (cleared when the tab/browser closes). Always
 * clears the other storage first so a later login with the opposite choice doesn't leave
 * a stale, conflicting copy behind.
 */
export function setTokens(accessToken: string, refreshToken: string, remember = true): void {
  if (typeof window === 'undefined') {
    return;
  }
  const target = remember ? window.localStorage : window.sessionStorage;
  const other = remember ? window.sessionStorage : window.localStorage;
  other.removeItem(ACCESS_TOKEN_STORAGE_KEY);
  other.removeItem(REFRESH_TOKEN_STORAGE_KEY);
  target.setItem(ACCESS_TOKEN_STORAGE_KEY, accessToken);
  target.setItem(REFRESH_TOKEN_STORAGE_KEY, refreshToken);
}

export function clearTokens(): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
  window.localStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY);
  window.sessionStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
  window.sessionStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY);
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Thin fetch wrapper: attaches the bearer token (if present) and normalises error bodies
 *  into {@link ApiError}. No retries/caching here — TanStack Query already owns that. */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getAccessToken();
  const response = await fetch(`${env.NEXT_PUBLIC_API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => undefined);
    throw new ApiError(response.status, body?.message ?? response.statusText, body);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}
