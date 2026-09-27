/**
 * Recruitment domain audit action catalog (Sprint 30, docs/domains/
 * recruitment.md) — the exact `HR_AUDIT_ACTIONS`/`MAINTENANCE_AUDIT_ACTIONS`
 * `<entity>.<event>` naming convention. Reuses the SAME `AuditLog` table via
 * the existing `AuditService.record()` — no second audit system.
 */
export const RECRUITMENT_AUDIT_ACTIONS = {
  HIRING_REQUEST_CREATED: 'hr.recruitment.hiring_request.created',
  HIRING_REQUEST_SUBMITTED: 'hr.recruitment.hiring_request.submitted',
  HIRING_REQUEST_APPROVED: 'hr.recruitment.hiring_request.approved',
  HIRING_REQUEST_REJECTED: 'hr.recruitment.hiring_request.rejected',
  HIRING_REQUEST_CANCELLED: 'hr.recruitment.hiring_request.cancelled',
  VACANCY_CREATED: 'hr.recruitment.vacancy.created',
  VACANCY_UPDATED: 'hr.recruitment.vacancy.updated',
  VACANCY_PUBLISHED: 'hr.recruitment.vacancy.published',
  VACANCY_PAUSED: 'hr.recruitment.vacancy.paused',
  VACANCY_CLOSED: 'hr.recruitment.vacancy.closed',
  VACANCY_CANCELLED: 'hr.recruitment.vacancy.cancelled',
  APPLICATION_SUBMITTED: 'hr.recruitment.application.submitted',
  APPLICATION_SCREENED: 'hr.recruitment.application.screened',
  APPLICATION_SHORTLISTED: 'hr.recruitment.application.shortlisted',
  APPLICATION_REJECTED: 'hr.recruitment.application.rejected',
  INTERVIEW_STAGE_CONFIGURED: 'hr.recruitment.interview_stage.configured',
  INTERVIEW_STAGE_PARTICIPANT_ASSIGNED: 'hr.recruitment.interview_stage.participant_assigned',
  INTERVIEW_SCHEDULED: 'hr.recruitment.interview.scheduled',
  INTERVIEW_EVALUATION_SUBMITTED: 'hr.recruitment.interview_evaluation.submitted',
  INTERVIEW_EVALUATION_REOPENED: 'hr.recruitment.interview_evaluation.reopened',
  INTERVIEW_STAGE_DECISION_RECORDED: 'hr.recruitment.interview_stage_decision.recorded',
  OFFER_CREATED: 'hr.recruitment.offer.created',
  OFFER_ISSUED: 'hr.recruitment.offer.issued',
  OFFER_ACCEPTED: 'hr.recruitment.offer.accepted',
  OFFER_DECLINED: 'hr.recruitment.offer.declined',
  OFFER_WITHDRAWN: 'hr.recruitment.offer.withdrawn',
  CANDIDATE_CONVERTED_TO_EMPLOYEE: 'hr.recruitment.candidate.converted_to_employee',
} as const;
