import type { BadgeProps } from '@zentuva/ui';

import type { AccessScope, PermissionScopeType, RoleStatus } from './api';

export const ROLE_STATUS_LABELS: Record<RoleStatus, string> = {
  ACTIVE: 'Active',
  ARCHIVED: 'Archived',
};

export const ROLE_STATUS_VARIANT: Record<RoleStatus, NonNullable<BadgeProps['variant']>> = {
  ACTIVE: 'success',
  ARCHIVED: 'default',
};

export const ACCESS_SCOPE_LABELS: Record<AccessScope, string> = {
  ORGANISATION: 'Whole Organisation',
  OWN_RECORDS: 'Own Records Only',
  OWN_TEAM: 'Own Team',
  DEPARTMENT: 'Own Department',
  ASSIGNED_RECORDS: 'Assigned Records',
  ASSIGNED_TERRITORY: 'Assigned Territory',
  ASSIGNED_ASSETS: 'Assigned Assets',
  NONE: 'No Access (scoped to nothing)',
};

export const PERMISSION_SCOPE_TYPE_LABELS: Record<PermissionScopeType, string> = {
  NONE: 'Organisation-wide',
  SCOPABLE: 'Scoped',
};

export const COMMON_ACCESS_CAPABILITY_LABELS: Record<string, string> = {
  selfSignIn: 'Self sign-in',
  selfSignOut: 'Self sign-out',
  viewOwnSchedule: 'View own work schedule',
  viewOwnAttendance: 'View own attendance',
  submitAttendanceCorrection: 'Submit attendance correction',
  viewAssignedTraining: 'View assigned training',
  completeAssignedTraining: 'Complete assigned training',
  viewApplicablePolicies: 'View applicable policies',
  acknowledgePolicies: 'Acknowledge policies',
  viewOwnProfile: 'View own employee profile',
};
