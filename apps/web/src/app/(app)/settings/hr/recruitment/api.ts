import { apiFetch } from '@/lib/api-client';

/**
 * Sprint 30 — Recruitment & Candidate Interview Management Foundation. The
 * exact `settings/hr/api.ts` one-shared-file-per-domain convention. Hiring
 * Request APPROVAL routing uses the GENERIC `settings/workflows/api.ts`
 * functions directly (`createWorkflowInstance`/`submitWorkflowInstance`/
 * `approveWorkflowInstance`) — never a recruitment-owned wrapper, matching
 * how the backend keeps Workflow and Recruitment genuinely separate.
 */

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export type EmploymentType =
  'FULL_TIME' | 'PART_TIME' | 'CONTRACT' | 'TEMPORARY' | 'INTERN' | 'CASUAL' | 'VOLUNTEER';

export type WorkArrangement = 'ON_SITE' | 'REMOTE' | 'HYBRID';
export type ApplicationQuestionType = 'TEXT' | 'YES_NO' | 'NUMBER' | 'FILE';
export type HiringRequestReason = 'NEW_POSITION' | 'REPLACEMENT' | 'EXPANSION' | 'OTHER';
export type HiringRequestStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
export type VacancyStatus = 'DRAFT' | 'PUBLISHED' | 'PAUSED' | 'CLOSED' | 'CANCELLED';
export type ApplicationStatus =
  | 'SUBMITTED'
  | 'SCREENING'
  | 'SHORTLISTED'
  | 'INTERVIEWING'
  | 'SELECTED'
  | 'REJECTED'
  | 'WITHDRAWN';
export type InterviewStatus = 'SCHEDULED' | 'COMPLETED' | 'CANCELLED';
export type InterviewRecommendation =
  'PROCEED' | 'HOLD' | 'REJECT' | 'RECOMMEND_HIRE' | 'RECOMMEND_REJECT';
export type StageDecisionType = 'ADVANCE' | 'HOLD' | 'REJECT';
export type OfferStatus = 'DRAFT' | 'ISSUED' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED' | 'WITHDRAWN';

// ---------------------------------------------------------------------------
// Hiring Requests
// ---------------------------------------------------------------------------

export interface HiringRequest {
  id: string;
  departmentId: string;
  positionId: string;
  department?: { id: string; name: string };
  position?: { id: string; title: string };
  requestedHeadcount: number;
  employmentType: EmploymentType;
  reason: HiringRequestReason;
  justification: string | null;
  requestedStartDate: string | null;
  requestedById: string;
  status: HiringRequestStatus;
  createdAt: string;
}

export function listHiringRequests(params?: { status?: HiringRequestStatus }) {
  const qs = new URLSearchParams();
  if (params?.status) qs.set('status', params.status);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return apiFetch<HiringRequest[]>(`/hr/recruitment/hiring-requests${suffix}`);
}

export function getHiringRequest(id: string) {
  return apiFetch<HiringRequest>(`/hr/recruitment/hiring-requests/${id}`);
}

export function createHiringRequest(payload: {
  departmentId: string;
  positionId: string;
  requestedHeadcount: number;
  employmentType: EmploymentType;
  reason: HiringRequestReason;
  justification?: string;
  requestedStartDate?: string;
}) {
  return apiFetch<HiringRequest>('/hr/recruitment/hiring-requests', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function submitHiringRequest(id: string) {
  return apiFetch<{ transitioned: boolean }>(`/hr/recruitment/hiring-requests/${id}/submit`, {
    method: 'POST',
  });
}

export function approveHiringRequestDirectly(id: string, comment?: string) {
  return apiFetch<{ transitioned: boolean }>(`/hr/recruitment/hiring-requests/${id}/approve`, {
    method: 'POST',
    body: JSON.stringify({ comment }),
  });
}

export function rejectHiringRequestDirectly(id: string, comment?: string) {
  return apiFetch<{ transitioned: boolean }>(`/hr/recruitment/hiring-requests/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({ comment }),
  });
}

export function cancelHiringRequest(id: string) {
  return apiFetch<{ transitioned: boolean }>(`/hr/recruitment/hiring-requests/${id}/cancel`, {
    method: 'POST',
  });
}

// ---------------------------------------------------------------------------
// Vacancies
// ---------------------------------------------------------------------------

export interface VacancyQuestion {
  id: string;
  label: string;
  type: ApplicationQuestionType;
  required: boolean;
  sortOrder: number;
}

export interface InterviewStageParticipant {
  id: string;
  userId: string;
}

export interface InterviewStage {
  id: string;
  vacancyId: string;
  name: string;
  description: string | null;
  sequence: number;
  isRequired: boolean;
  evaluationRequired: boolean;
  participants: InterviewStageParticipant[];
}

export interface Vacancy {
  id: string;
  title: string;
  positionId: string;
  departmentId: string | null;
  hiringRequestId: string | null;
  position?: { id: string; title: string };
  department?: { id: string; name: string } | null;
  numberOfOpenings: number;
  employmentType: EmploymentType;
  workArrangement: WorkArrangement;
  location: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  description: string;
  responsibilities: string;
  requirements: string;
  qualifications: string;
  experienceRequirements: string | null;
  applicationDeadline: string | null;
  status: VacancyStatus;
  publicSlug: string;
  publishedAt: string | null;
  closedAt: string | null;
  questions?: VacancyQuestion[];
  interviewStages?: InterviewStage[];
}

export function listVacancies(params?: { status?: VacancyStatus; search?: string }) {
  const qs = new URLSearchParams();
  if (params?.status) qs.set('status', params.status);
  if (params?.search) qs.set('search', params.search);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return apiFetch<Vacancy[]>(`/hr/recruitment/vacancies${suffix}`);
}

export function getVacancy(id: string) {
  return apiFetch<Vacancy>(`/hr/recruitment/vacancies/${id}`);
}

export interface CreateVacancyPayload {
  title: string;
  positionId: string;
  departmentId?: string;
  hiringRequestId?: string;
  numberOfOpenings: number;
  employmentType: EmploymentType;
  workArrangement: WorkArrangement;
  location?: string;
  salaryMin?: number;
  salaryMax?: number;
  description: string;
  responsibilities: string;
  requirements: string;
  qualifications: string;
  experienceRequirements?: string;
  applicationDeadline?: string;
  publicSlug: string;
  questions: {
    label: string;
    type: ApplicationQuestionType;
    required: boolean;
    sortOrder: number;
  }[];
}

export function createVacancy(payload: CreateVacancyPayload) {
  return apiFetch<Vacancy>('/hr/recruitment/vacancies', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateVacancy(
  id: string,
  payload: Partial<Omit<CreateVacancyPayload, 'questions'>>,
) {
  return apiFetch<Vacancy>(`/hr/recruitment/vacancies/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function publishVacancy(id: string) {
  return apiFetch<{ transitioned: boolean }>(`/hr/recruitment/vacancies/${id}/publish`, {
    method: 'POST',
  });
}

export function pauseVacancy(id: string) {
  return apiFetch<{ transitioned: boolean }>(`/hr/recruitment/vacancies/${id}/pause`, {
    method: 'POST',
  });
}

export function closeVacancy(id: string) {
  return apiFetch<{ transitioned: boolean }>(`/hr/recruitment/vacancies/${id}/close`, {
    method: 'POST',
  });
}

export function cancelVacancy(id: string) {
  return apiFetch<{ transitioned: boolean }>(`/hr/recruitment/vacancies/${id}/cancel`, {
    method: 'POST',
  });
}

export function listInterviewStages(vacancyId: string) {
  return apiFetch<InterviewStage[]>(`/hr/recruitment/vacancies/${vacancyId}/interview-stages`);
}

export function createInterviewStage(
  vacancyId: string,
  payload: {
    name: string;
    description?: string;
    sequence: number;
    isRequired: boolean;
    evaluationRequired: boolean;
    participantUserIds: string[];
  },
) {
  return apiFetch<InterviewStage>(`/hr/recruitment/vacancies/${vacancyId}/interview-stages`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function replaceInterviewStageParticipants(stageId: string, participantUserIds: string[]) {
  return apiFetch<InterviewStage>(
    `/hr/recruitment/vacancies/interview-stages/${stageId}/participants`,
    { method: 'PATCH', body: JSON.stringify({ participantUserIds }) },
  );
}

// ---------------------------------------------------------------------------
// Applications & Screening
// ---------------------------------------------------------------------------

export interface Candidate {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  location: string | null;
}

export interface ApplicationAnswer {
  id: string;
  vacancyQuestionId: string;
  answerText: string | null;
  answerNumber: number | null;
  answerBoolean: boolean | null;
  answerFileUrl: string | null;
  vacancyQuestion?: VacancyQuestion;
}

export interface Application {
  id: string;
  vacancyId: string;
  candidateId: string;
  candidate?: Candidate;
  vacancy?: { id: string; title: string; interviewStages?: InterviewStage[] };
  status: ApplicationStatus;
  resumeUrl: string | null;
  coverLetterText: string | null;
  screeningNotes: string | null;
  submittedAt: string;
  answers?: ApplicationAnswer[];
  interviews?: Interview[];
  offers?: Offer[];
}

export function listApplications(params?: { vacancyId?: string; status?: ApplicationStatus }) {
  const qs = new URLSearchParams();
  if (params?.vacancyId) qs.set('vacancyId', params.vacancyId);
  if (params?.status) qs.set('status', params.status);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return apiFetch<Application[]>(`/hr/recruitment/applications${suffix}`);
}

export function getApplication(id: string) {
  return apiFetch<Application>(`/hr/recruitment/applications/${id}`);
}

export function screenApplication(id: string, screeningNotes?: string) {
  return apiFetch<Application>(`/hr/recruitment/applications/${id}/screen`, {
    method: 'POST',
    body: JSON.stringify({ screeningNotes }),
  });
}

export function shortlistApplication(id: string, screeningNotes?: string) {
  return apiFetch<Application>(`/hr/recruitment/applications/${id}/shortlist`, {
    method: 'POST',
    body: JSON.stringify({ screeningNotes }),
  });
}

export function rejectApplication(id: string, screeningNotes?: string) {
  return apiFetch<Application>(`/hr/recruitment/applications/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({ screeningNotes }),
  });
}

// ---------------------------------------------------------------------------
// Interviews (HR-facing)
// ---------------------------------------------------------------------------

export interface InterviewEvaluation {
  id: string;
  interviewId: string;
  evaluatorUserId: string;
  score: number;
  recommendation: InterviewRecommendation;
  comments: string | null;
  submittedAt: string;
  reopenedAt: string | null;
}

export interface InterviewStageDecision {
  id: string;
  interviewId: string;
  decision: StageDecisionType;
  decidedByUserId: string;
  decidedAt: string;
  comment: string | null;
}

export interface Interview {
  id: string;
  applicationId: string;
  interviewStageId: string;
  interviewStage?: InterviewStage;
  scheduledAt: string | null;
  durationMinutes: number | null;
  location: string | null;
  meetingLink: string | null;
  status: InterviewStatus;
  participants?: InterviewStageParticipant[];
  evaluations?: InterviewEvaluation[];
  decisions?: InterviewStageDecision[];
}

export function listInterviewsForApplication(applicationId: string) {
  return apiFetch<Interview[]>(`/hr/recruitment/interviews?applicationId=${applicationId}`);
}

export function getInterview(id: string) {
  return apiFetch<Interview>(`/hr/recruitment/interviews/${id}`);
}

export interface StageSummary {
  evaluatorsAssigned: number;
  evaluationsCompleted: number;
  averageScore: number | null;
  recommendationCounts: Record<string, number>;
}

export function getInterviewSummary(id: string) {
  return apiFetch<StageSummary>(`/hr/recruitment/interviews/${id}/summary`);
}

export function scheduleInterview(payload: {
  applicationId: string;
  interviewStageId: string;
  scheduledAt: string;
  durationMinutes?: number;
  location?: string;
  meetingLink?: string;
  participantUserIds: string[];
}) {
  return apiFetch<Interview>('/hr/recruitment/interviews', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function decideInterviewStage(
  interviewId: string,
  decision: StageDecisionType,
  comment?: string,
) {
  return apiFetch<InterviewStageDecision>(`/hr/recruitment/interviews/${interviewId}/decide`, {
    method: 'POST',
    body: JSON.stringify({ decision, comment }),
  });
}

export function reopenEvaluation(evaluationId: string, reason: string) {
  return apiFetch<InterviewEvaluation>(`/hr-interviews/evaluations/${evaluationId}/reopen`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

// ---------------------------------------------------------------------------
// Offers
// ---------------------------------------------------------------------------

export interface Offer {
  id: string;
  applicationId: string;
  application?: { candidate: Candidate; vacancy: { title: string } };
  proposedSalary: number | null;
  employmentType: EmploymentType;
  proposedStartDate: string | null;
  offerDate: string;
  expiryDate: string | null;
  status: OfferStatus;
  notes: string | null;
  convertedEmployeeId: string | null;
}

export function listOffers(params?: { status?: OfferStatus }) {
  const qs = new URLSearchParams();
  if (params?.status) qs.set('status', params.status);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return apiFetch<Offer[]>(`/hr/recruitment/offers${suffix}`);
}

export function getOffer(id: string) {
  return apiFetch<Offer>(`/hr/recruitment/offers/${id}`);
}

export function createOffer(
  applicationId: string,
  payload: {
    proposedSalary?: number;
    employmentType: EmploymentType;
    proposedStartDate?: string;
    expiryDate?: string;
    notes?: string;
  },
) {
  return apiFetch<Offer>(`/hr/recruitment/offers/applications/${applicationId}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function issueOffer(id: string) {
  return apiFetch<Offer>(`/hr/recruitment/offers/${id}/issue`, { method: 'POST' });
}

export interface AcceptOfferResult {
  offer: Offer;
  employee: { id: string; employeeCode: string; firstName: string; lastName: string };
  wasNewConversion: boolean;
}

export function acceptOffer(id: string) {
  return apiFetch<AcceptOfferResult>(`/hr/recruitment/offers/${id}/accept`, { method: 'POST' });
}

export function declineOffer(id: string, notes?: string) {
  return apiFetch<Offer>(`/hr/recruitment/offers/${id}/decline`, {
    method: 'POST',
    body: JSON.stringify({ notes }),
  });
}

export function withdrawOffer(id: string) {
  return apiFetch<Offer>(`/hr/recruitment/offers/${id}/withdraw`, { method: 'POST' });
}
