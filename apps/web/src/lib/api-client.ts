import { env } from './env';

const ACCESS_TOKEN_STORAGE_KEY = 'zentuva_access_token';

/**
 * Reads the bearer access token from localStorage.
 *
 * There's no login page yet (out of scope for Sprint 2.1's brief, which asks only for the
 * Organisation Settings page) — a real login flow/auth context is a known gap, see
 * docs/sprint-2.1-completion-report.md "Known limitations". Until then, whatever page
 * signs the user in is expected to persist the token under this key.
 */
export function getAccessToken(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return window.localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY);
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
