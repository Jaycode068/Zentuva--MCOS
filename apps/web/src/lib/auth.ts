import type { LoginInput, RegisterOrganisationInput } from '@zentuva/validation';

import { apiFetch, clearTokens } from './api-client';

/** `POST /api/auth/register` response — see apps/api/src/identity/auth/auth.controller.ts. */
export interface RegisterResult {
  organisation: {
    id: string;
    name: string;
    organisationCode: string;
    slug: string;
  };
  owner: {
    id: string;
    email: string;
  };
}

export function registerOrganisation(input: RegisterOrganisationInput): Promise<RegisterResult> {
  return apiFetch<RegisterResult>('/auth/register', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** `POST /api/auth/login` response — `mustChangePassword` added Sprint 3.3 (§5, "First
 *  Login Password Change"). */
export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    organisationId: string;
    status: string;
    mustChangePassword: boolean;
  };
}

export function login(input: LoginInput): Promise<LoginResult> {
  return apiFetch<LoginResult>('/auth/login', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function logout(): Promise<void> {
  try {
    await apiFetch<void>('/auth/logout', { method: 'POST' });
  } finally {
    clearTokens();
  }
}

/** `POST /api/auth/password/request-reset` (Sprint 1B.2, unused by any frontend until
 *  Sprint 3.2) — always responds `200`, whether or not the email exists (standard
 *  practice, so the response can't be used to enumerate accounts). */
export function requestPasswordReset(email: string): Promise<{ resetToken?: string }> {
  return apiFetch<{ resetToken?: string }>('/auth/password/request-reset', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

/** `POST /api/auth/password/reset` (Sprint 1B.2 backend, wired to a frontend page for the
 *  first time in Sprint 3.3 — see `/reset-password/[token]`). */
export function resetPassword(token: string, newPassword: string): Promise<void> {
  return apiFetch<void>('/auth/password/reset', {
    method: 'POST',
    body: JSON.stringify({ token, newPassword }),
  });
}
