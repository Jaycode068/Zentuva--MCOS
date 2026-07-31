import { env } from './env';

const ACCESS_TOKEN_STORAGE_KEY = 'zentuva_access_token';
const REFRESH_TOKEN_STORAGE_KEY = 'zentuva_refresh_token';

/** Reads the bearer access token from localStorage. Set by the login page (Sprint 3.2) —
 *  before that, no page actually wrote it, so this always returned `null`; see
 *  docs/sprint-2.1-completion-report.md "Known limitations" for that history. */
export function getAccessToken(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return window.localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY);
}

/** Persists both tokens after a successful login (Sprint 3.2). `refreshToken` is stored
 *  for future use — nothing reads it yet, `apiFetch` below only ever sends the access
 *  token; there is no refresh-on-401 flow in this sprint. */
export function setTokens(accessToken: string, refreshToken: string): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, accessToken);
  window.localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, refreshToken);
}

export function clearTokens(): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
  window.localStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY);
}

/**
 * Decodes the current access token's `sub` claim (the user id) without verifying the
 * signature — this is only ever used to know *which* user to fetch display details for
 * (the authenticated nav's avatar), never for an authorization decision. Every real
 * authorization check still happens server-side via `JwtAuthGuard` on each request.
 */
export function getCurrentUserId(): string | null {
  const token = getAccessToken();
  if (!token) {
    return null;
  }
  try {
    const payloadSegment = token.split('.')[1] ?? '';
    const payload = JSON.parse(atob(payloadSegment.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
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
