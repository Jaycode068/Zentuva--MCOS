import { BadRequestException, NotFoundException } from '@nestjs/common';

import { DepartmentService } from '../department.service';
import { PositionService } from '../position.service';
import { HiringRequestRepository } from './hiring-request.repository';
import { VacancyRepository } from './vacancy.repository';
import { VacancyService } from './vacancy.service';

describe('VacancyService', () => {
  function makeService() {
    const repo = {
      findById: jest.fn(),
      findByIdWithRelations: jest.fn(),
      findBySlug: jest.fn().mockResolvedValue(null),
      slugExists: jest.fn().mockResolvedValue(false),
      list: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      publish: jest.fn(),
      pause: jest.fn(),
      close: jest.fn(),
      cancel: jest.fn(),
    } as unknown as jest.Mocked<VacancyRepository>;
    const departmentService = {
      getById: jest.fn().mockResolvedValue({ id: 'dept-1' }),
    } as unknown as jest.Mocked<DepartmentService>;
    const positionService = {
      getById: jest.fn().mockResolvedValue({ id: 'pos-1' }),
    } as unknown as jest.Mocked<PositionService>;
    const hiringRequestRepository = {
      findById: jest.fn().mockResolvedValue({ id: 'hreq-1', status: 'APPROVED' }),
    } as unknown as jest.Mocked<HiringRequestRepository>;
    const service = new VacancyService(
      repo,
      departmentService,
      positionService,
      hiringRequestRepository,
    );
    return { service, repo, departmentService, positionService, hiringRequestRepository };
  }

  const baseInput = {
    title: 'Cashier',
    positionId: 'pos-1',
    numberOfOpenings: 1,
    employmentType: 'FULL_TIME',
    workArrangement: 'ON_SITE',
    description: 'd',
    responsibilities: 'r',
    requirements: 'req',
    qualifications: 'q',
    publicSlug: 'cashier',
    questions: [],
  };

  describe('create', () => {
    it('rejects a duplicate slug within the organisation', async () => {
      const { service, repo } = makeService();
      repo.slugExists.mockResolvedValue(true);

      await expect(service.create('org-1', baseInput as never, 'creator-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('validates the position exists, and the hiring request when supplied', async () => {
      const { service, repo, positionService, hiringRequestRepository } = makeService();
      repo.create.mockResolvedValue({ id: 'v-1' } as never);

      await service.create(
        'org-1',
        { ...baseInput, hiringRequestId: 'hreq-1' } as never,
        'creator-1',
      );

      expect(positionService.getById).toHaveBeenCalledWith('org-1', 'pos-1');
      expect(hiringRequestRepository.findById).toHaveBeenCalledWith('org-1', 'hreq-1');
    });

    it('rejects a hiring request that does not exist in this organisation', async () => {
      const { service, hiringRequestRepository } = makeService();
      hiringRequestRepository.findById.mockResolvedValue(null);

      await expect(
        service.create('org-1', { ...baseInput, hiringRequestId: 'hreq-x' } as never, 'creator-1'),
      ).rejects.toThrow(NotFoundException);
    });

    /**
     * "Hiring Request → HR Approval → Public Vacancy Flow" audit — the
     * real defect this sprint found and fixed: `create()` previously only
     * checked that a supplied `hiringRequestId` EXISTED, never that it had
     * actually been approved, so a DRAFT/SUBMITTED/REJECTED/CANCELLED
     * hiring request could be silently linked to a brand-new vacancy —
     * collapsing "our department needs someone" into "HR has approved this
     * opportunity" without HR ever approving anything.
     */
    it.each(['DRAFT', 'SUBMITTED', 'REJECTED', 'CANCELLED'])(
      'rejects creating a vacancy from a hiring request that is %s, not APPROVED',
      async (status) => {
        const { service, hiringRequestRepository } = makeService();
        hiringRequestRepository.findById.mockResolvedValue({ id: 'hreq-1', status } as never);

        await expect(
          service.create(
            'org-1',
            { ...baseInput, hiringRequestId: 'hreq-1' } as never,
            'creator-1',
          ),
        ).rejects.toThrow(BadRequestException);
      },
    );

    it('allows creating a vacancy from an APPROVED hiring request', async () => {
      const { service, repo, hiringRequestRepository } = makeService();
      hiringRequestRepository.findById.mockResolvedValue({
        id: 'hreq-1',
        status: 'APPROVED',
      } as never);
      repo.create.mockResolvedValue({ id: 'v-1' } as never);

      await expect(
        service.create('org-1', { ...baseInput, hiringRequestId: 'hreq-1' } as never, 'creator-1'),
      ).resolves.toEqual({ id: 'v-1' });
    });

    it('allows an administrative vacancy with no hiring request at all', async () => {
      const { service, repo, hiringRequestRepository } = makeService();
      repo.create.mockResolvedValue({ id: 'v-1' } as never);

      await service.create('org-1', baseInput as never, 'creator-1');

      expect(hiringRequestRepository.findById).not.toHaveBeenCalled();
    });
  });

  describe('publish/pause/close/cancel', () => {
    it('publish throws when the vacancy cannot transition (e.g. already CLOSED)', async () => {
      const { service, repo } = makeService();
      repo.findById.mockResolvedValue({ id: 'v-1', status: 'CLOSED' } as never);
      repo.publish.mockResolvedValue({ transitioned: false, vacancy: null });

      await expect(service.publish('org-1', 'v-1')).rejects.toThrow(BadRequestException);
    });

    it('publish succeeds from DRAFT', async () => {
      const { service, repo } = makeService();
      repo.findById.mockResolvedValue({ id: 'v-1', status: 'DRAFT' } as never);
      repo.publish.mockResolvedValue({ transitioned: true, vacancy: {} as never });

      await expect(service.publish('org-1', 'v-1')).resolves.toEqual({ transitioned: true });
    });

    it('close throws when the vacancy is not PUBLISHED/PAUSED', async () => {
      const { service, repo } = makeService();
      repo.findById.mockResolvedValue({ id: 'v-1', status: 'DRAFT' } as never);
      repo.close.mockResolvedValue({ transitioned: false, vacancy: null });

      await expect(service.close('org-1', 'v-1')).rejects.toThrow(BadRequestException);
    });
  });
});
