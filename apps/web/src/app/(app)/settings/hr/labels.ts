import type { BadgeProps } from '@zentuva/ui';

import type {
  AttendanceCorrectionStatus,
  AttendanceReviewStatus,
  AttendanceStatus,
  DepartmentStatus,
  EmployeeDocumentStatus,
  EmployeeDocumentType,
  EmployeeTrainingStatus,
  EmploymentStatus,
  EmploymentType,
  Gender,
  OnboardingStatus,
  PolicyStatus,
  PolicyVersionStatus,
  PositionStatus,
  TrainingCourseStatus,
  TrainingDeliveryMode,
  WorkScheduleStatus,
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

// ---------------------------------------------------------------------------
// Sprint 24 — Work schedules, Attendance, Policies, Training
// ---------------------------------------------------------------------------

export const WORK_SCHEDULE_STATUS_LABELS: Record<WorkScheduleStatus, string> = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
};

export const WORK_SCHEDULE_STATUS_VARIANT: Record<
  WorkScheduleStatus,
  NonNullable<BadgeProps['variant']>
> = {
  ACTIVE: 'success',
  INACTIVE: 'default',
};

export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  PRESENT: 'Present',
  LATE: 'Late',
  ABSENT: 'Absent',
  INCOMPLETE: 'Incomplete',
  OFF_DAY: 'Off Day',
  EXCUSED: 'Excused',
  PENDING_REVIEW: 'Pending Review',
};

export const ATTENDANCE_STATUS_VARIANT: Record<
  AttendanceStatus,
  NonNullable<BadgeProps['variant']>
> = {
  PRESENT: 'success',
  LATE: 'warning',
  ABSENT: 'destructive',
  INCOMPLETE: 'warning',
  OFF_DAY: 'default',
  EXCUSED: 'default',
  PENDING_REVIEW: 'default',
};

export const ATTENDANCE_REVIEW_STATUS_LABELS: Record<AttendanceReviewStatus, string> = {
  NOT_REVIEWED: 'Not Reviewed',
  APPROVED: 'Approved',
  REQUIRES_CORRECTION: 'Requires Correction',
  REJECTED: 'Rejected',
};

export const ATTENDANCE_REVIEW_STATUS_VARIANT: Record<
  AttendanceReviewStatus,
  NonNullable<BadgeProps['variant']>
> = {
  NOT_REVIEWED: 'default',
  APPROVED: 'success',
  REQUIRES_CORRECTION: 'warning',
  REJECTED: 'destructive',
};

export const ATTENDANCE_CORRECTION_STATUS_LABELS: Record<AttendanceCorrectionStatus, string> = {
  REQUESTED: 'Requested',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
};

export const ATTENDANCE_CORRECTION_STATUS_VARIANT: Record<
  AttendanceCorrectionStatus,
  NonNullable<BadgeProps['variant']>
> = {
  REQUESTED: 'warning',
  APPROVED: 'success',
  REJECTED: 'destructive',
  CANCELLED: 'default',
};

export const POLICY_STATUS_LABELS: Record<PolicyStatus, string> = {
  DRAFT: 'Draft',
  ACTIVE: 'Active',
  ARCHIVED: 'Archived',
};

export const POLICY_STATUS_VARIANT: Record<PolicyStatus, NonNullable<BadgeProps['variant']>> = {
  DRAFT: 'default',
  ACTIVE: 'success',
  ARCHIVED: 'default',
};

export const POLICY_VERSION_STATUS_LABELS: Record<PolicyVersionStatus, string> = {
  DRAFT: 'Draft',
  PUBLISHED: 'Published',
  ARCHIVED: 'Archived',
};

export const POLICY_VERSION_STATUS_VARIANT: Record<
  PolicyVersionStatus,
  NonNullable<BadgeProps['variant']>
> = {
  DRAFT: 'default',
  PUBLISHED: 'success',
  ARCHIVED: 'default',
};

export const TRAINING_DELIVERY_MODE_LABELS: Record<TrainingDeliveryMode, string> = {
  IN_PERSON: 'In Person',
  ONLINE: 'Online',
  BLENDED: 'Blended',
  SELF_STUDY: 'Self Study',
};

export const TRAINING_COURSE_STATUS_LABELS: Record<TrainingCourseStatus, string> = {
  DRAFT: 'Draft',
  ACTIVE: 'Active',
  ARCHIVED: 'Archived',
};

export const TRAINING_COURSE_STATUS_VARIANT: Record<
  TrainingCourseStatus,
  NonNullable<BadgeProps['variant']>
> = {
  DRAFT: 'default',
  ACTIVE: 'success',
  ARCHIVED: 'default',
};

export const EMPLOYEE_TRAINING_STATUS_LABELS: Record<EmployeeTrainingStatus, string> = {
  ASSIGNED: 'Assigned',
  IN_PROGRESS: 'In Progress',
  COMPLETED: 'Completed',
  OVERDUE: 'Overdue',
  CANCELLED: 'Cancelled',
};

export const EMPLOYEE_TRAINING_STATUS_VARIANT: Record<
  EmployeeTrainingStatus,
  NonNullable<BadgeProps['variant']>
> = {
  ASSIGNED: 'default',
  IN_PROGRESS: 'warning',
  COMPLETED: 'success',
  OVERDUE: 'destructive',
  CANCELLED: 'default',
};
