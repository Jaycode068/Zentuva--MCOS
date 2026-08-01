import type { ChangePasswordInput, UpdateAccountProfileInput } from '@zentuva/validation';

import { apiFetch } from './api-client';

/** `GET/PATCH /api/account/profile` response — see
 *  apps/api/src/identity/account/account.controller.ts. */
export interface AccountProfile {
  id: string;
  firstName: string;
  lastName: string;
  phoneNumber: string | null;
  employeeCode: string | null;
  email: string;
  role: string | null;
  organisation: { id: string; name: string; organisationCode: string } | null;
  status: string;
  joinedAt: string;
  lastLoginAt: string | null;
  failedLoginAttempts: number;
  passwordChangedAt: string | null;
  mustChangePassword: boolean;
}

export function getAccountProfile(): Promise<AccountProfile> {
  return apiFetch<AccountProfile>('/account/profile');
}

export function updateAccountProfile(input: UpdateAccountProfileInput): Promise<AccountProfile> {
  return apiFetch<AccountProfile>('/account/profile', {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function changePassword(input: ChangePasswordInput): Promise<void> {
  return apiFetch<void>('/account/change-password', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** `GET /api/account/sessions` response — one row per active `Session` (Sprint 3.3 §4). */
export interface AccountSession {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  lastActivityAt: string;
  isCurrent: boolean;
}

export function getAccountSessions(): Promise<{ items: AccountSession[] }> {
  return apiFetch<{ items: AccountSession[] }>('/account/sessions');
}

export function revokeSession(
  id: string,
): Promise<{ revoked: boolean; wasCurrentSession: boolean }> {
  return apiFetch<{ revoked: boolean; wasCurrentSession: boolean }>(`/account/sessions/${id}`, {
    method: 'DELETE',
  });
}
