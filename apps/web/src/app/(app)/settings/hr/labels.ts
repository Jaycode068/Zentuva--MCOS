import type { BadgeProps } from '@zentuva/ui';

import type {
  DepartmentStatus,
  EmployeeDocumentStatus,
  EmployeeDocumentType,
  EmploymentStatus,
  EmploymentType,
  Gender,
  OnboardingStatus,
  PositionStatus,
} from './api';

export const DEPARTMENT_STATUS_LABELS: Record<DepartmentStatus, string> = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
};

export const DEPARTMENT_STATUS_VARIANT: Record<
  DepartmentStatus,
  NonNullable<BadgeProps['variant']>
> = {
  ACTIVE: 'success',
  INACTIVE: 'default',
};

export const POSITION_STATUS_LABELS: Record<PositionStatus, string> = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
};

export const POSITION_STATUS_VARIANT: Record<PositionStatus, NonNullable<BadgeProps['variant']>> = {
  ACTIVE: 'success',
  INACTIVE: 'default',
};

export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  FULL_TIME: 'Full-Time',
  PART_TIME: 'Part-Time',
  CONTRACT: 'Contract',
  TEMPORARY: 'Temporary',
  INTERN: 'Intern',
  CASUAL: 'Casual',
  VOLUNTEER: 'Volunteer',
};

export const EMPLOYMENT_STATUS_LABELS: Record<EmploymentStatus, string> = {
  DRAFT: 'Draft',
  ONBOARDING: 'Onboarding',
  ACTIVE: 'Active',
  ON_LEAVE: 'On Leave',
  SUSPENDED: 'Suspended',
  SEPARATED: 'Separated',
};

export const EMPLOYMENT_STATUS_VARIANT: Record<
  EmploymentStatus,
  NonNullable<BadgeProps['variant']>
> = {
  DRAFT: 'default',
  ONBOARDING: 'warning',
  ACTIVE: 'success',
  ON_LEAVE: 'warning',
  SUSPENDED: 'destructive',
  SEPARATED: 'default',
};

export const GENDER_LABELS: Record<Gender, string> = {
  MALE: 'Male',
  FEMALE: 'Female',
  OTHER: 'Other',
  PREFER_NOT_TO_SAY: 'Prefer not to say',
};

export const EMPLOYEE_DOCUMENT_TYPE_LABELS: Record<EmployeeDocumentType, string> = {
  EMPLOYMENT_CONTRACT: 'Employment Contract',
  IDENTIFICATION: 'Identification',
  QUALIFICATION: 'Qualification',
  CERTIFICATION: 'Certification',
  POLICY_ACKNOWLEDGEMENT: 'Policy Acknowledgement',
  ONBOARDING_DOCUMENT: 'Onboarding Document',
  OTHER: 'Other',
};

export const EMPLOYEE_DOCUMENT_STATUS_LABELS: Record<EmployeeDocumentStatus, string> = {
  ACTIVE: 'Active',
  ARCHIVED: 'Archived',
};

export const ONBOARDING_STATUS_LABELS: Record<OnboardingStatus, string> = {
  NOT_STARTED: 'Not Started',
  IN_PROGRESS: 'In Progress',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export const ONBOARDING_STATUS_VARIANT: Record<
  OnboardingStatus,
  NonNullable<BadgeProps['variant']>
> = {
  NOT_STARTED: 'default',
  IN_PROGRESS: 'warning',
  COMPLETED: 'success',
  CANCELLED: 'destructive',
};
