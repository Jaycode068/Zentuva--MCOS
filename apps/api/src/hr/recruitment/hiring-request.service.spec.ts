import { BadRequestException, NotFoundException } from '@nestjs/common';

import { DepartmentService } from '../department.service';
import { PositionService } from '../position.service';
import { HiringRequestRepository } from './hiring-request.repository';
import { HiringRequestService } from './hiring-request.service';

describe('HiringRequestService', () => {
  function makeService() {
    const repo = {
      findById: jest.fn(),
      findByIdWithRelations: jest.fn(),
      list: jest.fn(),
      create: jest.fn(),
      submit: jest.fn(),
      approve: jest.fn(),
      reject: jest.fn(),
      revertToDraft: jest.fn(),
      cancel: jest.fn(),
    } as unknown as jest.Mocked<HiringRequestRepository>;
    const departmentService = {
      getById: jest.fn().mockResolvedValue({ id: 'dept-1' }),
    } as unknown as jest.Mocked<DepartmentService>;
    const positionService = {
      getById: jest.fn().mockResolvedValue({ id: 'pos-1' }),
    } as unknown as jest.Mocked<PositionService>;
    const service = new HiringRequestService(repo, departmentService, positionService);
    return { service, repo, departmentService, positionService };
  }

  describe('create', () => {
    it('validates the department and position exist before creating', async () => {
      const { service, repo, departmentService, positionService } = makeService();
      repo.create.mockResolvedValue({ id: 'hr-1' } as never);

      await service.create(
        'org-1',
        {
          departmentId: 'dept-1',
          positionId: 'pos-1',
          requestedHeadcount: 1,
          employmentType: 'FULL_TIME',
          reason: 'REPLACEMENT',
        } as never,
        'requester-1',
      );

      expect(departmentService.getById).toHaveBeenCalledWith('org-1', 'dept-1');
      expect(positionService.getById).toHaveBeenCalledWith('org-1', 'pos-1');
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ organisationId: 'org-1', requestedById: 'requester-1' }),
      );
    });
  });

  describe('getById', () => {
    it('throws NotFoundException for a nonexistent or cross-tenant id', async () => {
      const { service, repo } = makeService();
      repo.findById.mockResolvedValue(null);

      await expect(service.getById('org-1', 'hr-x')).rejects.toThrow(NotFoundException);
    });
  });

  describe('submit', () => {
    it('throws BadRequestException when the request is not DRAFT', async () => {
      const { service, repo } = makeService();
      repo.findById.mockResolvedValue({ id: 'hr-1', status: 'SUBMITTED' } as never);
      repo.submit.mockResolvedValue({ transitioned: false, hiringRequest: null });

      await expect(service.submit('org-1', 'hr-1')).rejects.toThrow(BadRequestException);
    });

    it('succeeds when the request is DRAFT', async () => {
      const { service, repo } = makeService();
      repo.findById.mockResolvedValue({ id: 'hr-1', status: 'DRAFT' } as never);
      repo.submit.mockResolvedValue({ transitioned: true, hiringRequest: {} as never });

      const result = await service.submit('org-1', 'hr-1');
      expect(result).toEqual({ transitioned: true });
    });
  });

  describe('cancel', () => {
    it('throws BadRequestException from a terminal status', async () => {
      const { service, repo } = makeService();
      repo.findById.mockResolvedValue({ id: 'hr-1', status: 'APPROVED' } as never);
      repo.cancel.mockResolvedValue({ transitioned: false, hiringRequest: null });

      await expect(service.cancel('org-1', 'hr-1')).rejects.toThrow(BadRequestException);
    });
  });
});
