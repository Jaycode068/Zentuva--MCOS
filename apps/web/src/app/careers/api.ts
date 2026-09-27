import { apiFetch, apiFetchFormData } from '@/lib/api-client';

/**
 * Sprint 30 — Recruitment & Candidate Interview Management Foundation
 * (recruitment.md §"Public Careers Page"). Fully public — `apiFetch` works
 * unauthenticated fine (it only attaches a bearer token when one exists), no
 * separate client needed. Response shapes here mirror the backend's own
 * hand-built allowlist DTOs exactly — never expose more than the API
 * already returns.
 */

export interface PublicOrganisationInfo {
  name: string;
  logoUrl: string | null;
  industry: string | null;
  city: string | null;
  country: string | null;
  description: string | null;
}

export interface PublicVacancySummary {
  publicSlug: string;
  title: string;
  departmentName: string | null;
  location: string | null;
  employmentType: string;
  workArrangement: string;
  applicationDeadline: string | null;
}

export interface PublicVacancyQuestion {
  id: string;
  label: string;
  type: 'TEXT' | 'YES_NO' | 'NUMBER' | 'FILE';
  required: boolean;
}

export interface PublicVacancyDetail extends PublicVacancySummary {
  description: string;
  responsibilities: string;
  requirements: string;
  qualifications: string;
  experienceRequirements: string | null;
  numberOfOpenings: number;
  salaryMin: number | null;
  salaryMax: number | null;
  questions: PublicVacancyQuestion[];
}

export function getOrganisationCareers(organisationSlug: string) {
  return apiFetch<{ organisation: PublicOrganisationInfo; vacancies: PublicVacancySummary[] }>(
    `/careers/${organisationSlug}`,
  );
}

export function getPublicVacancy(organisationSlug: string, vacancySlug: string) {
  return apiFetch<PublicVacancyDetail>(`/careers/${organisationSlug}/${vacancySlug}`);
}

export interface PublicApplicationAnswer {
  vacancyQuestionId: string;
  answerText?: string;
  answerNumber?: number;
  answerBoolean?: boolean;
}

export function submitPublicApplication(
  organisationSlug: string,
  vacancySlug: string,
  payload: {
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
    location?: string;
    coverLetterText?: string;
    answers: PublicApplicationAnswer[];
  },
  resumeFile?: File,
) {
  const formData = new FormData();
  formData.append('payload', JSON.stringify(payload));
  if (resumeFile) {
    formData.append('resume', resumeFile);
  }
  return apiFetchFormData<{ success: true; submittedAt: string }>(
    `/careers/${organisationSlug}/${vacancySlug}/apply`,
    formData,
  );
}
