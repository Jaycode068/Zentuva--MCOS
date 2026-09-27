import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SubmitPublicApplicationInput } from '@zentuva/validation';

import { OrganisationService } from '../../../identity/organisation/organisation.service';
import { FILE_STORAGE, FileStorage } from '../../../identity/organisation/ports/file-storage.port';
import { ApplicationRepository } from '../application.repository';
import { CandidateRepository } from '../candidate.repository';
import { VacancyRepository } from '../vacancy.repository';

export interface PublicVacancySummary {
  publicSlug: string;
  title: string;
  departmentName: string | null;
  location: string | null;
  employmentType: string;
  workArrangement: string;
  applicationDeadline: Date | null;
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
  questions: { id: string; label: string; type: string; required: boolean }[];
}

/**
 * Sprint 30 — Recruitment & Candidate Interview Management Foundation
 * (recruitment.md §"Public Careers Page" / §"Public Application Security" /
 * §"Candidate Privacy"). Every response shape here is a HAND-BUILT allowlist
 * — never a raw Prisma object — explicitly excluding: draft/internal
 * vacancies, internal notes, applicant data, interview configuration,
 * interviewer identities, internal HR comments, unpublished salary
 * information, and private organisation configuration. Organisation
 * resolution is `organisationId`-scoped from the start (via `slug`) — no
 * response here can ever leak whether a slug/vacancy exists in a DIFFERENT
 * organisation than the one requested.
 */
@Injectable()
export class CareersService {
  constructor(
    private readonly organisationService: OrganisationService,
    private readonly vacancyRepository: VacancyRepository,
    private readonly candidateRepository: CandidateRepository,
    private readonly applicationRepository: ApplicationRepository,
    @Inject(FILE_STORAGE) private readonly fileStorage: FileStorage,
  ) {}

  private async resolveActiveOrganisationId(organisationSlug: string): Promise<string> {
    const organisation = await this.organisationService.getBySlug(organisationSlug);
    if (!organisation || organisation.status !== 'ACTIVE') {
      throw new NotFoundException('Organisation not found');
    }
    return organisation.id;
  }

  async getOrganisationCareersInfo(organisationSlug: string) {
    const organisation = await this.organisationService.getBySlug(organisationSlug);
    if (!organisation || organisation.status !== 'ACTIVE') {
      throw new NotFoundException('Organisation not found');
    }
    return {
      name: organisation.displayName ?? organisation.name,
      logoUrl: organisation.logoUrl,
      industry: organisation.industry,
      city: organisation.city,
      country: organisation.country,
      description: organisation.description,
    };
  }

  async listPublicVacancies(organisationSlug: string): Promise<PublicVacancySummary[]> {
    const organisationId = await this.resolveActiveOrganisationId(organisationSlug);
    const vacancies = await this.vacancyRepository.findPublicList(organisationId);
    return vacancies.map((v) => ({
      publicSlug: v.publicSlug,
      title: v.title,
      departmentName: v.department?.name ?? null,
      location: v.location,
      employmentType: v.employmentType,
      workArrangement: v.workArrangement,
      applicationDeadline: v.applicationDeadline,
    }));
  }

  async getPublicVacancy(
    organisationSlug: string,
    vacancySlug: string,
  ): Promise<PublicVacancyDetail> {
    const organisationId = await this.resolveActiveOrganisationId(organisationSlug);
    const vacancy = await this.vacancyRepository.findPublicBySlug(organisationId, vacancySlug);
    if (!vacancy) {
      throw new NotFoundException('Vacancy not found');
    }
    return {
      publicSlug: vacancy.publicSlug,
      title: vacancy.title,
      departmentName: vacancy.department?.name ?? null,
      location: vacancy.location,
      employmentType: vacancy.employmentType,
      workArrangement: vacancy.workArrangement,
      applicationDeadline: vacancy.applicationDeadline,
      description: vacancy.description,
      responsibilities: vacancy.responsibilities,
      requirements: vacancy.requirements,
      qualifications: vacancy.qualifications,
      experienceRequirements: vacancy.experienceRequirements,
      numberOfOpenings: vacancy.numberOfOpenings,
      salaryMin: vacancy.salaryMin,
      salaryMax: vacancy.salaryMax,
      questions: vacancy.questions.map((q) => ({
        id: q.id,
        label: q.label,
        type: q.type,
        required: q.required,
      })),
    };
  }

  /** Public application submission (recruitment.md §"Public Application
   *  Security"). Validates every required question is answered, uploads the
   *  resume via the existing `FileStorage` port (never a second storage
   *  system), and returns ONLY a minimal success confirmation — no
   *  candidate/application id, since there is deliberately no candidate
   *  portal/account this sprint (brief §53). */
  async submitApplication(
    organisationSlug: string,
    vacancySlug: string,
    input: SubmitPublicApplicationInput,
    resumeFile?: { buffer: Buffer; mimeType: string },
  ): Promise<{ success: true; submittedAt: Date }> {
    const organisationId = await this.resolveActiveOrganisationId(organisationSlug);
    const vacancy = await this.vacancyRepository.findPublicBySlug(organisationId, vacancySlug);
    if (!vacancy) {
      throw new NotFoundException('Vacancy not found');
    }

    const requiredQuestionIds = new Set(
      vacancy.questions.filter((q) => q.required).map((q) => q.id),
    );
    const answeredQuestionIds = new Set(input.answers.map((a) => a.vacancyQuestionId));
    for (const questionId of requiredQuestionIds) {
      if (!answeredQuestionIds.has(questionId)) {
        throw new BadRequestException('One or more required questions were not answered');
      }
    }
    const validQuestionIds = new Set(vacancy.questions.map((q) => q.id));
    for (const answer of input.answers) {
      if (!validQuestionIds.has(answer.vacancyQuestionId)) {
        throw new BadRequestException('An answer referenced a question that does not exist');
      }
    }

    const candidate = await this.candidateRepository.findOrCreate({
      organisationId,
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      phone: input.phone,
      location: input.location,
    });

    const existing = await this.applicationRepository.findExisting(
      organisationId,
      vacancy.id,
      candidate.id,
    );
    if (existing) {
      throw new BadRequestException(
        'An application for this vacancy already exists for this email',
      );
    }

    let resumeUrl: string | undefined;
    let resumeKey: string | undefined;
    if (resumeFile) {
      const uploaded = await this.fileStorage.upload({
        organisationId,
        folder: 'recruitment-resumes',
        mimeType: resumeFile.mimeType,
        buffer: resumeFile.buffer,
      });
      resumeUrl = uploaded.url;
      resumeKey = uploaded.key;
    }

    const application = await this.applicationRepository.create({
      organisationId,
      vacancyId: vacancy.id,
      candidateId: candidate.id,
      resumeUrl,
      resumeKey,
      coverLetterText: input.coverLetterText,
      answers: input.answers.map((a) => ({
        vacancyQuestionId: a.vacancyQuestionId,
        answerText: a.answerText,
        answerNumber: a.answerNumber,
        answerBoolean: a.answerBoolean,
      })),
    });
    if (!application) {
      throw new BadRequestException(
        'An application for this vacancy already exists for this email',
      );
    }

    return { success: true, submittedAt: application.submittedAt };
  }
}
