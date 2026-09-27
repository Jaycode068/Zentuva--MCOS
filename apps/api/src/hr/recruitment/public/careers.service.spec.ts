import { BadRequestException, NotFoundException } from '@nestjs/common';

import { OrganisationService } from '../../../identity/organisation/organisation.service';
import { FileStorage } from '../../../identity/organisation/ports/file-storage.port';
import { ApplicationRepository } from '../application.repository';
import { CandidateRepository } from '../candidate.repository';
import { VacancyRepository } from '../vacancy.repository';
import { CareersService } from './careers.service';

describe('CareersService', () => {
  function makeService() {
    const organisationService = {
      getBySlug: jest.fn(),
    } as unknown as jest.Mocked<OrganisationService>;
    const vacancyRepository = {
      findPublicList: jest.fn(),
      findPublicBySlug: jest.fn(),
    } as unknown as jest.Mocked<VacancyRepository>;
    const candidateRepository = {
      findOrCreate: jest.fn(),
    } as unknown as jest.Mocked<CandidateRepository>;
    const applicationRepository = {
      findExisting: jest.fn(),
      create: jest.fn(),
    } as unknown as jest.Mocked<ApplicationRepository>;
    const fileStorage = {
      upload: jest.fn(),
      delete: jest.fn(),
    } as unknown as jest.Mocked<FileStorage>;
    const service = new CareersService(
      organisationService,
      vacancyRepository,
      candidateRepository,
      applicationRepository,
      fileStorage,
    );
    return {
      service,
      organisationService,
      vacancyRepository,
      candidateRepository,
      applicationRepository,
      fileStorage,
    };
  }

  const activeOrg = {
    id: 'org-1',
    status: 'ACTIVE',
    name: 'Boby Bites',
    displayName: null,
    logoUrl: null,
    industry: 'Food & Beverage',
    city: 'Ibadan',
    country: 'Nigeria',
    description: null,
  };

  describe('tenant resolution', () => {
    it('404s for an organisation slug that does not exist', async () => {
      const { service, organisationService } = makeService();
      organisationService.getBySlug.mockResolvedValue(null);

      await expect(service.listPublicVacancies('nope')).rejects.toThrow(NotFoundException);
    });

    it('404s for a non-ACTIVE organisation (never serves a suspended/pending tenant publicly)', async () => {
      const { service, organisationService } = makeService();
      organisationService.getBySlug.mockResolvedValue({
        ...activeOrg,
        status: 'SUSPENDED',
      } as never);

      await expect(service.listPublicVacancies('boby-bites')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getOrganisationCareersInfo', () => {
    it('404s for an organisation slug that does not exist', async () => {
      const { service, organisationService } = makeService();
      organisationService.getBySlug.mockResolvedValue(null);

      await expect(service.getOrganisationCareersInfo('nope')).rejects.toThrow(NotFoundException);
    });

    it('returns public branding/identity fields only — never businessEmail/phone/address', async () => {
      const { service, organisationService } = makeService();
      organisationService.getBySlug.mockResolvedValue({
        ...activeOrg,
        businessEmail: 'internal@bobybites.local',
        phone: '+2340000000',
        addressLine1: '1 Secret Street',
      } as never);

      const result = await service.getOrganisationCareersInfo('boby-bites');

      expect(result).toEqual({
        name: 'Boby Bites',
        logoUrl: null,
        industry: 'Food & Beverage',
        city: 'Ibadan',
        country: 'Nigeria',
        description: null,
      });
    });
  });

  describe('getPublicVacancy', () => {
    it('404s for a vacancy slug that does not exist in this organisation (no cross-tenant leak)', async () => {
      const { service, organisationService, vacancyRepository } = makeService();
      organisationService.getBySlug.mockResolvedValue(activeOrg as never);
      vacancyRepository.findPublicBySlug.mockResolvedValue(null);

      await expect(service.getPublicVacancy('boby-bites', 'cashier')).rejects.toThrow(
        NotFoundException,
      );
      expect(vacancyRepository.findPublicBySlug).toHaveBeenCalledWith('org-1', 'cashier');
    });

    it('never includes internal fields (screeningNotes/interviewers/questionInternalId) in the shape', async () => {
      const { service, organisationService, vacancyRepository } = makeService();
      organisationService.getBySlug.mockResolvedValue(activeOrg as never);
      vacancyRepository.findPublicBySlug.mockResolvedValue({
        publicSlug: 'cashier',
        title: 'Cashier',
        department: { name: 'Finance' },
        location: 'Ibadan',
        employmentType: 'FULL_TIME',
        workArrangement: 'ON_SITE',
        applicationDeadline: null,
        description: 'd',
        responsibilities: 'r',
        requirements: 'req',
        qualifications: 'q',
        experienceRequirements: null,
        numberOfOpenings: 1,
        salaryMin: null,
        salaryMax: null,
        questions: [{ id: 'q1', label: 'Experience?', type: 'YES_NO', required: true }],
      } as never);

      const result = await service.getPublicVacancy('boby-bites', 'cashier');
      expect(Object.keys(result)).not.toContain('screeningNotes');
      expect(Object.keys(result)).not.toContain('createdById');
      expect(result.questions).toEqual([
        { id: 'q1', label: 'Experience?', type: 'YES_NO', required: true },
      ]);
    });
  });

  describe('submitApplication', () => {
    const vacancy = {
      id: 'v-1',
      questions: [
        { id: 'q1', required: true },
        { id: 'q2', required: false },
      ],
    };

    function setupHappyPath(overrides: Partial<typeof vacancy> = {}) {
      const ctx = makeService();
      ctx.organisationService.getBySlug.mockResolvedValue(activeOrg as never);
      ctx.vacancyRepository.findPublicBySlug.mockResolvedValue({
        ...vacancy,
        ...overrides,
      } as never);
      ctx.candidateRepository.findOrCreate.mockResolvedValue({ id: 'cand-1' } as never);
      ctx.applicationRepository.findExisting.mockResolvedValue(null);
      ctx.applicationRepository.create.mockResolvedValue({
        id: 'app-1',
        submittedAt: new Date('2026-01-01'),
      } as never);
      ctx.fileStorage.upload.mockResolvedValue({
        url: 'http://localhost:4000/api/uploads/resume.pdf',
        key: 'recruitment-resumes/org-1/resume.pdf',
      });
      return ctx;
    }

    it('404s when the vacancy does not exist / is not public', async () => {
      const { service, organisationService, vacancyRepository } = makeService();
      organisationService.getBySlug.mockResolvedValue(activeOrg as never);
      vacancyRepository.findPublicBySlug.mockResolvedValue(null);

      await expect(
        service.submitApplication('boby-bites', 'cashier', {
          firstName: 'A',
          lastName: 'B',
          email: 'a@b.com',
          answers: [],
        } as never),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects when a required question is not answered', async () => {
      const ctx = setupHappyPath();
      await expect(
        ctx.service.submitApplication('boby-bites', 'cashier', {
          firstName: 'A',
          lastName: 'B',
          email: 'a@b.com',
          answers: [],
        } as never),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an answer referencing a question that does not belong to this vacancy', async () => {
      const ctx = setupHappyPath();
      await expect(
        ctx.service.submitApplication('boby-bites', 'cashier', {
          firstName: 'A',
          lastName: 'B',
          email: 'a@b.com',
          answers: [
            { vacancyQuestionId: 'q1', answerBoolean: true },
            { vacancyQuestionId: 'q-not-real', answerText: 'x' },
          ],
        } as never),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a duplicate application from the same candidate for the same vacancy', async () => {
      const ctx = setupHappyPath();
      ctx.applicationRepository.findExisting.mockResolvedValue({ id: 'existing' } as never);

      await expect(
        ctx.service.submitApplication('boby-bites', 'cashier', {
          firstName: 'A',
          lastName: 'B',
          email: 'a@b.com',
          answers: [{ vacancyQuestionId: 'q1', answerBoolean: true }],
        } as never),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts a valid application, uploads the resume, and returns only a minimal confirmation', async () => {
      const ctx = setupHappyPath();

      const result = await ctx.service.submitApplication(
        'boby-bites',
        'cashier',
        {
          firstName: 'John',
          lastName: 'Doe',
          email: 'john@example.com',
          answers: [{ vacancyQuestionId: 'q1', answerBoolean: true }],
        } as never,
        { buffer: Buffer.from('pdf'), mimeType: 'application/pdf' },
      );

      expect(ctx.fileStorage.upload).toHaveBeenCalledWith(
        expect.objectContaining({ folder: 'recruitment-resumes', organisationId: 'org-1' }),
      );
      expect(result).toEqual({ success: true, submittedAt: new Date('2026-01-01') });
      // Never leaks a candidate/application id — no candidate portal this sprint.
      expect(result).not.toHaveProperty('applicationId');
      expect(result).not.toHaveProperty('candidateId');
    });

    it('does not require a resume file', async () => {
      const ctx = setupHappyPath();

      await ctx.service.submitApplication('boby-bites', 'cashier', {
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@example.com',
        answers: [{ vacancyQuestionId: 'q1', answerBoolean: true }],
      } as never);

      expect(ctx.fileStorage.upload).not.toHaveBeenCalled();
    });
  });
});
