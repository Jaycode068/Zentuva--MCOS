import { apiFetch } from '@/lib/api-client';

/**
 * Shared API client for Sprint 25's Configurable Access Control
 * (docs/domains/access-control.md), following the exact `hr/api.ts`
 * one-shared-file-per-domain convention.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AccessScope =
  | 'ORGANISATION'
  | 'OWN_RECORDS'
  | 'OWN_TEAM'
  | 'DEPARTMENT'
  | 'ASSIGNED_RECORDS'
  | 'ASSIGNED_TERRITORY'
  | 'ASSIGNED_ASSETS'
  | 'NONE';

export type PermissionScopeType = 'NONE' | 'SCOPABLE';
export type RoleStatus = 'ACTIVE' | 'ARCHIVED';

export interface Permission {
  id: string;
  key: string;
  domain: string;
  resource: string;
  action: string;
  scopeType: PermissionScopeType;
  description: string | null;
}

export interface RolePermissionGrant {
  permissionId: string;
  scope: AccessScope | null;
  permission: Permission;
}

export interface Role {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  status: RoleStatus;
  createdAt: string;
  updatedAt: string;
}

export interface RoleWithCounts extends Role {
  userCount: number;
  permissionCount: number;
}

export interface RoleDetail extends Role {
  permissions: RolePermissionGrant[];
}

export interface EffectiveGrant {
  permissionKey: string;
  scopeType: PermissionScopeType;
  scopes: AccessScope[];
  sourceRoleNames: string[];
}

export interface EffectiveAccessPreview {
  userIsActive: boolean;
  isOwnerBypass: boolean;
  roles: { id: string; name: string }[];
  grants: EffectiveGrant[];
}

export interface UserAccessRow {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  userStatus: string;
  employee: {
    id: string;
    employeeCode: string;
    department: { id: string; name: string } | null;
    position: { id: string; title: string } | null;
    manager: { id: string; firstName: string; lastName: string } | null;
    employmentStatus: string;
  } | null;
  roles: { id: string; name: string; status: RoleStatus }[];
}

export interface CommonEmployeeAccessPolicy {
  selfSignIn: boolean;
  selfSignOut: boolean;
  viewOwnSchedule: boolean;
  viewOwnAttendance: boolean;
  submitAttendanceCorrection: boolean;
  viewAssignedTraining: boolean;
  completeAssignedTraining: boolean;
  viewApplicablePolicies: boolean;
  acknowledgePolicies: boolean;
  viewOwnProfile: boolean;
}

export interface AccessOverview {
  totalRoles: number;
  activeRoles: number;
  archivedRoles: number;
  systemRoles: number;
  customRoles: number;
  totalUsers: number;
  usersWithoutAnyRole: number;
  usersWithMultipleRoles: number;
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export function getAccessOverview() {
  return apiFetch<AccessOverview>('/access/overview');
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

export function listRoles() {
  return apiFetch<RoleWithCounts[]>('/access/roles');
}

export function listPermissions(module?: string) {
  const qs = module ? `?module=${encodeURIComponent(module)}` : '';
  return apiFetch<{ items: Permission[] }>(`/access/roles/permissions${qs}`);
}

export function getRole(id: string) {
  return apiFetch<RoleDetail>(`/access/roles/${id}`);
}

export interface PermissionGrantInput {
  permissionKey: string;
  scope?: AccessScope;
}

export function createRole(payload: {
  name: string;
  description?: string;
  permissions?: PermissionGrantInput[];
}) {
  return apiFetch<Role>('/access/roles', { method: 'POST', body: JSON.stringify(payload) });
}

export function updateRole(id: string, payload: { name?: string; description?: string | null }) {
  return apiFetch<Role>(`/access/roles/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
}

export function setRolePermissions(id: string, permissions: PermissionGrantInput[]) {
  return apiFetch<{ items: RolePermissionGrant[] }>(`/access/roles/${id}/permissions`, {
    method: 'POST',
    body: JSON.stringify({ permissions }),
  });
}

export function archiveRole(id: string) {
  return apiFetch<Role>(`/access/roles/${id}/archive`, { method: 'POST' });
}

export function restoreRole(id: string) {
  return apiFetch<Role>(`/access/roles/${id}/restore`, { method: 'POST' });
}

export function duplicateRole(id: string, name: string) {
  return apiFetch<Role>(`/access/roles/${id}/duplicate`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

// ---------------------------------------------------------------------------
// User Access
// ---------------------------------------------------------------------------

export function listUserAccess() {
  return apiFetch<{ items: UserAccessRow[] }>('/access/users');
}

export function getEffectiveAccess(userId: string) {
  return apiFetch<EffectiveAccessPreview>(`/access/users/${userId}/effective-access`);
}

export function assignUserRole(userId: string, roleId: string) {
  return apiFetch<{ items: { id: string; name: string; status: RoleStatus }[] }>(
    `/access/users/${userId}/roles`,
    { method: 'POST', body: JSON.stringify({ roleId }) },
  );
}

export function removeUserRole(userId: string, roleId: string) {
  return apiFetch<{ items: { id: string; name: string; status: RoleStatus }[] }>(
    `/access/users/${userId}/roles/${roleId}`,
    { method: 'DELETE' },
  );
}

// ---------------------------------------------------------------------------
// Common Employee Access Policy
// ---------------------------------------------------------------------------

export function getCommonAccessPolicy() {
  return apiFetch<CommonEmployeeAccessPolicy>('/access/common-policy');
}

export function updateCommonAccessPolicy(payload: Partial<CommonEmployeeAccessPolicy>) {
  return apiFetch<CommonEmployeeAccessPolicy>('/access/common-policy', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

// ---------------------------------------------------------------------------
// Access Review (audit log)
// ---------------------------------------------------------------------------

export interface AuditLogEntry {
  id: string;
  actorUserId: string | null;
  actorEmail: string | null;
  action: string;
  entityType: string;
  entityId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export function listAccessAuditLog(params?: { action?: string; take?: number }) {
  const qs = new URLSearchParams();
  if (params?.action) qs.set('action', params.action);
  if (params?.take) qs.set('take', String(params.take));
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return apiFetch<{ items: AuditLogEntry[]; total: number }>(`/access/audit-log${suffix}`);
}
