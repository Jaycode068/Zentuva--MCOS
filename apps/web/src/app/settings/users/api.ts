import type { CreateUserInput, UpdateUserInput } from '@zentuva/validation';

import { apiFetch } from '@/lib/api-client';

/** `GET/POST /api/users`, `GET/PATCH /api/users/:id` response shape — see
 *  apps/api/src/identity/user/user.controller.ts. */
export interface OrgUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  employeeCode: string | null;
  role: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'LOCKED';
  createdAt: string;
  updatedAt: string;
}

export function listUsers(): Promise<{ items: OrgUser[] }> {
  return apiFetch<{ items: OrgUser[] }>('/users');
}

/** Added Sprint 3.2 — the authenticated top nav's avatar needs the current user's own
 *  name/initials. */
export function getUser(id: string): Promise<OrgUser> {
  return apiFetch<OrgUser>(`/users/${id}`);
}

export function createUser(input: CreateUserInput): Promise<OrgUser> {
  return apiFetch<OrgUser>('/users', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateUser(id: string, input: UpdateUserInput): Promise<OrgUser> {
  return apiFetch<OrgUser>(`/users/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}
