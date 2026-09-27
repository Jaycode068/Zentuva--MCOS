import { apiFetch } from '@/lib/api-client';

/**
 * Sprint 30 — Recruitment & Candidate Interview Management Foundation
 * (recruitment.md §"Interview Evaluation" / §"Mobile"). SELF-SCOPED — every
 * function here calls a `JwtAuthGuard`-only backend route (no
 * `hr.recruitment.*` permission required), reachable by any authenticated
 * user who has been assigned as an interview panelist regardless of their
 * other permissions.
 */

export type InterviewRecommendation =
  'PROCEED' | 'HOLD' | 'REJECT' | 'RECOMMEND_HIRE' | 'RECOMMEND_REJECT';

export interface MyInterview {
  id: string;
  scheduledAt: string | null;
  durationMinutes: number | null;
  location: string | null;
  meetingLink: string | null;
  status: 'SCHEDULED' | 'COMPLETED' | 'CANCELLED';
  interviewStage: { id: string; name: string; sequence: number };
  application: {
    candidate: { firstName: string; lastName: string };
    vacancy: { title: string };
  };
  evaluations: { id: string; score: number; recommendation: InterviewRecommendation }[];
}

export function listMyEvaluations() {
  return apiFetch<MyInterview[]>('/hr-interviews/my-evaluations');
}

export interface MyEvaluation {
  id: string;
  score: number;
  recommendation: InterviewRecommendation;
  comments: string | null;
  submittedAt: string;
}

export interface MyInterviewDetail {
  interview: MyInterview & { interviewStage: MyInterview['interviewStage'] & { sequence: number } };
  ownEvaluation: MyEvaluation | null;
}

export function getMyInterview(id: string) {
  return apiFetch<MyInterviewDetail>(`/hr-interviews/${id}`);
}

export function submitMyEvaluation(
  id: string,
  payload: { score: number; recommendation: InterviewRecommendation; comments?: string },
) {
  return apiFetch<MyEvaluation>(`/hr-interviews/${id}/evaluate`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
