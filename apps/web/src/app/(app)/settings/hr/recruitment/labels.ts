import type { BadgeProps } from '@zentuva/ui';

import type {
  ApplicationStatus,
  HiringRequestStatus,
  InterviewRecommendation,
  InterviewStatus,
  OfferStatus,
  StageDecisionType,
  VacancyStatus,
  WorkArrangement,
} from './api';

type Variant = NonNullable<BadgeProps['variant']>;

export const HIRING_REQUEST_STATUS_LABELS: Record<HiringRequestStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
};
export const HIRING_REQUEST_STATUS_VARIANT: Record<HiringRequestStatus, Variant> = {
  DRAFT: 'default',
  SUBMITTED: 'warning',
  APPROVED: 'success',
  REJECTED: 'destructive',
  CANCELLED: 'default',
};

export const VACANCY_STATUS_LABELS: Record<VacancyStatus, string> = {
  DRAFT: 'Draft',
  PUBLISHED: 'Published',
  PAUSED: 'Paused',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
};
export const VACANCY_STATUS_VARIANT: Record<VacancyStatus, Variant> = {
  DRAFT: 'default',
  PUBLISHED: 'success',
  PAUSED: 'warning',
  CLOSED: 'default',
  CANCELLED: 'destructive',
};

export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  SUBMITTED: 'Submitted',
  SCREENING: 'Screening',
  SHORTLISTED: 'Shortlisted',
  INTERVIEWING: 'Interviewing',
  SELECTED: 'Selected',
  REJECTED: 'Rejected',
  WITHDRAWN: 'Withdrawn',
};
export const APPLICATION_STATUS_VARIANT: Record<ApplicationStatus, Variant> = {
  SUBMITTED: 'default',
  SCREENING: 'warning',
  SHORTLISTED: 'success',
  INTERVIEWING: 'success',
  SELECTED: 'success',
  REJECTED: 'destructive',
  WITHDRAWN: 'default',
};

export const INTERVIEW_STATUS_LABELS: Record<InterviewStatus, string> = {
  SCHEDULED: 'Scheduled',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export const WORK_ARRANGEMENT_LABELS: Record<WorkArrangement, string> = {
  ON_SITE: 'On-site',
  REMOTE: 'Remote',
  HYBRID: 'Hybrid',
};

export const RECOMMENDATION_LABELS: Record<InterviewRecommendation, string> = {
  PROCEED: 'Proceed',
  HOLD: 'Hold',
  REJECT: 'Reject',
  RECOMMEND_HIRE: 'Recommend Hire',
  RECOMMEND_REJECT: 'Recommend Reject',
};

export const STAGE_DECISION_LABELS: Record<StageDecisionType, string> = {
  ADVANCE: 'Advance',
  HOLD: 'Hold',
  REJECT: 'Reject',
};

export const OFFER_STATUS_LABELS: Record<OfferStatus, string> = {
  DRAFT: 'Draft',
  ISSUED: 'Issued',
  ACCEPTED: 'Accepted',
  DECLINED: 'Declined',
  EXPIRED: 'Expired',
  WITHDRAWN: 'Withdrawn',
};
export const OFFER_STATUS_VARIANT: Record<OfferStatus, Variant> = {
  DRAFT: 'default',
  ISSUED: 'warning',
  ACCEPTED: 'success',
  DECLINED: 'destructive',
  EXPIRED: 'destructive',
  WITHDRAWN: 'default',
};
