import { z } from 'zod';

import { employmentTypeSchema } from './hr';

/**
 * Sprint 30 — Recruitment & Candidate Interview Management Foundation
 * (docs/domains/recruitment.md). Following the exact `hr.ts` one-shared-file
 * per-domain convention: one Zod schema per write endpoint, server always
 * injects `organisationId`/actor ids, never trusts them from the body.
 * Reuses `employmentTypeSchema` from `hr.ts` — no second employment-type enum.
 */

// ---------------------------------------------------------------------------
// Hiring Request
// ---------------------------------------------------------------------------

export const hiringRequestReasonSchema = z.enum([
  'NEW_POSITION',
  'REPLACEMENT',
  'EXPANSION',
  'OTHER',
]);

export const createHiringRequestSchema = z.object({
  departmentId: z.string().trim().min(1),
  positionId: z.string().trim().min(1),
  requestedHeadcount: z.coerce.number().int().min(1).max(1000).default(1),
  employmentType: employmentTypeSchema,
  reason: hiringRequestReasonSchema,
  justification: z.string().trim().max(2000).optional(),
  requestedStartDate: z.coerce.date().optional(),
});
export type CreateHiringRequestInput = z.infer<typeof createHiringRequestSchema>;

export const hiringRequestDecisionSchema = z.object({
  comment: z.string().trim().max(2000).optional(),
});
export type HiringRequestDecisionInput = z.infer<typeof hiringRequestDecisionSchema>;

// ---------------------------------------------------------------------------
// Vacancy
// ---------------------------------------------------------------------------

export const workArrangementSchema = z.enum(['ON_SITE', 'REMOTE', 'HYBRID']);

export const applicationQuestionTypeSchema = z.enum(['TEXT', 'YES_NO', 'NUMBER', 'FILE']);

export const vacancyQuestionInputSchema = z.object({
  label: z.string().trim().min(1).max(300),
  type: applicationQuestionTypeSchema,
  required: z.boolean().default(false),
  sortOrder: z.coerce.number().int().min(0).default(0),
});
export type VacancyQuestionInput = z.infer<typeof vacancyQuestionInputSchema>;

export const createVacancySchema = z.object({
  title: z.string().trim().min(1).max(160),
  positionId: z.string().trim().min(1),
  departmentId: z.string().trim().min(1).optional(),
  hiringRequestId: z.string().trim().min(1).optional(),
  numberOfOpenings: z.coerce.number().int().min(1).max(1000).default(1),
  employmentType: employmentTypeSchema,
  workArrangement: workArrangementSchema,
  location: z.string().trim().max(200).optional(),
  salaryMin: z.coerce.number().min(0).optional(),
  salaryMax: z.coerce.number().min(0).optional(),
  description: z.string().trim().min(1).max(10000),
  responsibilities: z.string().trim().min(1).max(10000),
  requirements: z.string().trim().min(1).max(10000),
  qualifications: z.string().trim().min(1).max(10000),
  experienceRequirements: z.string().trim().max(2000).optional(),
  applicationDeadline: z.coerce.date().optional(),
  publicSlug: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Must be lowercase letters, numbers, and hyphens only'),
  questions: z.array(vacancyQuestionInputSchema).max(20).default([]),
});
export type CreateVacancyInput = z.infer<typeof createVacancySchema>;

export const updateVacancySchema = createVacancySchema.partial().omit({ questions: true });
export type UpdateVacancyInput = z.infer<typeof updateVacancySchema>;

// ---------------------------------------------------------------------------
// Screening (HR-only, authenticated)
// ---------------------------------------------------------------------------

export const screenApplicationSchema = z.object({
  screeningNotes: z.string().trim().max(4000).optional(),
});
export type ScreenApplicationInput = z.infer<typeof screenApplicationSchema>;

export const rejectApplicationSchema = z.object({
  screeningNotes: z.string().trim().max(4000).optional(),
});
export type RejectApplicationInput = z.infer<typeof rejectApplicationSchema>;

// ---------------------------------------------------------------------------
// Public application (unauthenticated — apps/api/src/hr/recruitment/public/)
// ---------------------------------------------------------------------------

export const publicApplicationAnswerSchema = z.object({
  vacancyQuestionId: z.string().trim().min(1),
  answerText: z.string().trim().max(4000).optional(),
  answerNumber: z.coerce.number().optional(),
  answerBoolean: z.coerce.boolean().optional(),
});

export const submitPublicApplicationSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(160),
  phone: z.string().trim().max(30).optional(),
  location: z.string().trim().max(200).optional(),
  coverLetterText: z.string().trim().max(6000).optional(),
  answers: z.array(publicApplicationAnswerSchema).max(20).default([]),
});
export type SubmitPublicApplicationInput = z.infer<typeof submitPublicApplicationSchema>;

// ---------------------------------------------------------------------------
// Interview Stage configuration (HR-only)
// ---------------------------------------------------------------------------

export const createInterviewStageSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).optional(),
  sequence: z.coerce.number().int().min(1),
  isRequired: z.boolean().default(true),
  evaluationRequired: z.boolean().default(true),
  participantUserIds: z.array(z.string().trim().min(1)).max(20).default([]),
});
export type CreateInterviewStageInput = z.infer<typeof createInterviewStageSchema>;

export const updateInterviewStageParticipantsSchema = z.object({
  participantUserIds: z.array(z.string().trim().min(1)).max(20),
});
export type UpdateInterviewStageParticipantsInput = z.infer<
  typeof updateInterviewStageParticipantsSchema
>;

// ---------------------------------------------------------------------------
// Interview scheduling (HR-only)
// ---------------------------------------------------------------------------

export const scheduleInterviewSchema = z.object({
  scheduledAt: z.coerce.date(),
  durationMinutes: z.coerce.number().int().min(5).max(480).optional(),
  location: z.string().trim().max(300).optional(),
  meetingLink: z.string().trim().url().max(500).optional(),
  participantUserIds: z.array(z.string().trim().min(1)).min(1).max(20),
});
export type ScheduleInterviewInput = z.infer<typeof scheduleInterviewSchema>;

export const createInterviewSchema = scheduleInterviewSchema.extend({
  applicationId: z.string().trim().min(1),
  interviewStageId: z.string().trim().min(1),
});
export type CreateInterviewInput = z.infer<typeof createInterviewSchema>;

// ---------------------------------------------------------------------------
// Interview Evaluation (self-scoped — the assigned interviewer only)
// ---------------------------------------------------------------------------

export const interviewRecommendationSchema = z.enum([
  'PROCEED',
  'HOLD',
  'REJECT',
  'RECOMMEND_HIRE',
  'RECOMMEND_REJECT',
]);

export const submitInterviewEvaluationSchema = z.object({
  score: z.coerce.number().int().min(1).max(5),
  recommendation: interviewRecommendationSchema,
  comments: z.string().trim().max(4000).optional(),
});
export type SubmitInterviewEvaluationInput = z.infer<typeof submitInterviewEvaluationSchema>;

export const reopenInterviewEvaluationSchema = z.object({
  reason: z.string().trim().min(1).max(2000),
});
export type ReopenInterviewEvaluationInput = z.infer<typeof reopenInterviewEvaluationSchema>;

// ---------------------------------------------------------------------------
// Interview Stage Decision (HR-only)
// ---------------------------------------------------------------------------

export const stageDecisionTypeSchema = z.enum(['ADVANCE', 'HOLD', 'REJECT']);

export const recordStageDecisionSchema = z.object({
  decision: stageDecisionTypeSchema,
  comment: z.string().trim().max(2000).optional(),
});
export type RecordStageDecisionInput = z.infer<typeof recordStageDecisionSchema>;

// ---------------------------------------------------------------------------
// Offer (HR-only)
// ---------------------------------------------------------------------------

export const createOfferSchema = z.object({
  proposedSalary: z.coerce.number().min(0).optional(),
  employmentType: employmentTypeSchema,
  proposedStartDate: z.coerce.date().optional(),
  expiryDate: z.coerce.date().optional(),
  notes: z.string().trim().max(2000).optional(),
});
export type CreateOfferInput = z.infer<typeof createOfferSchema>;

export const declineOfferSchema = z.object({
  notes: z.string().trim().max(2000).optional(),
});
export type DeclineOfferInput = z.infer<typeof declineOfferSchema>;
