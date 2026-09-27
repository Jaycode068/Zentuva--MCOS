import { BadRequestException, NotFoundException } from '@nestjs/common';

import { EmployeeOnboardingService } from '../employee-onboarding.service';
import { EmployeeService } from '../employee.service';
import { ApplicationRepository } from './application.repository';
import { OfferRepository } from './offer.repository';
import { OfferService } from './offer.service';

describe('OfferService', () => {
  function makeService() {
    const offerRepository = {
      findById: jest.fn(),
      listByApplication: jest.fn(),
      list: jest.fn(),
      create: jest.fn(),
      issue: jest.fn(),
      decline: jest.fn(),
      withdraw: jest.fn(),
      expire: jest.fn(),
      claimAcceptance: jest.fn(),
      confirmConversion: jest.fn(),
    } as unknown as jest.Mocked<OfferRepository>;
    const applicationRepository = {
      findById: jest.fn(),
      findByIdWithRelations: jest.fn(),
      setStatus: jest.fn(),
    } as unknown as jest.Mocked<ApplicationRepository>;
    const employeeService = {
      create: jest.fn(),
      getById: jest.fn(),
    } as unknown as jest.Mocked<EmployeeService>;
    const employeeOnboardingService = {
      start: jest.fn(),
    } as unknown as jest.Mocked<EmployeeOnboardingService>;
    const service = new OfferService(
      offerRepository,
      applicationRepository,
      employeeService,
      employeeOnboardingService,
    );
    return {
      service,
      offerRepository,
      applicationRepository,
      employeeService,
      employeeOnboardingService,
    };
  }

  const application = {
    id: 'app-1',
    candidate: { firstName: 'John', lastName: 'Doe', email: 'john@example.com', phone: '0801' },
    vacancy: { departmentId: 'dept-1', positionId: 'pos-1' },
  };
  const issuedOffer = {
    id: 'offer-1',
    applicationId: 'app-1',
    status: 'ISSUED',
    convertedEmployeeId: null,
    employmentType: 'FULL_TIME',
    proposedStartDate: null,
  };

  describe('create', () => {
    it('rejects a duplicate active offer for the same application (partial-unique-index-backed)', async () => {
      const { service, applicationRepository, offerRepository } = makeService();
      applicationRepository.findById.mockResolvedValue({ id: 'app-1' } as never);
      offerRepository.create.mockResolvedValue(null);

      await expect(
        service.create('org-1', 'app-1', { employmentType: 'FULL_TIME' } as never, 'hr-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('accept — duplicate conversion prevention (brief §43/§50)', () => {
    it('is idempotent: an already-ACCEPTED offer with a converted employee returns the SAME employee, never a second one', async () => {
      const { service, offerRepository, employeeService } = makeService();
      offerRepository.findById.mockResolvedValue({
        ...issuedOffer,
        status: 'ACCEPTED',
        convertedEmployeeId: 'emp-1',
      } as never);
      employeeService.getById.mockResolvedValue({ id: 'emp-1' } as never);

      const result = await service.accept('org-1', 'offer-1', 'hr-1');

      expect(result.wasNewConversion).toBe(false);
      expect(result.employee).toEqual({ id: 'emp-1' });
      expect(employeeService.create).not.toHaveBeenCalled();
    });

    it('throws when the offer is not ISSUED and has no existing conversion', async () => {
      const { service, offerRepository } = makeService();
      offerRepository.findById.mockResolvedValue({ ...issuedOffer, status: 'DRAFT' } as never);
      offerRepository.claimAcceptance.mockResolvedValue(null);

      await expect(service.accept('org-1', 'offer-1', 'hr-1')).rejects.toThrow(BadRequestException);
    });

    it('creates the Employee ONLY AFTER winning the acceptance claim — never before (the actual concurrency fix)', async () => {
      const { service, offerRepository, applicationRepository, employeeService } = makeService();
      offerRepository.findById.mockResolvedValue(issuedOffer as never);
      offerRepository.claimAcceptance.mockResolvedValue(null); // lost the race

      await expect(service.accept('org-1', 'offer-1', 'hr-1')).rejects.toThrow(BadRequestException);
      expect(applicationRepository.findByIdWithRelations).not.toHaveBeenCalled();
      expect(employeeService.create).not.toHaveBeenCalled();
    });

    it('on a WON claim: creates exactly one Employee, starts onboarding, and marks the application SELECTED', async () => {
      const {
        service,
        offerRepository,
        applicationRepository,
        employeeService,
        employeeOnboardingService,
      } = makeService();
      offerRepository.findById.mockResolvedValue(issuedOffer as never);
      offerRepository.claimAcceptance.mockResolvedValue({
        ...issuedOffer,
        status: 'ACCEPTED',
      } as never);
      applicationRepository.findByIdWithRelations.mockResolvedValue(application as never);
      employeeService.create.mockResolvedValue({
        id: 'emp-1',
        employeeCode: 'EMP-000001',
      } as never);
      offerRepository.confirmConversion.mockResolvedValue({
        ...issuedOffer,
        status: 'ACCEPTED',
        convertedEmployeeId: 'emp-1',
      } as never);

      const result = await service.accept('org-1', 'offer-1', 'hr-1');

      expect(employeeService.create).toHaveBeenCalledTimes(1);
      expect(employeeService.create).toHaveBeenCalledWith(
        'org-1',
        expect.objectContaining({
          firstName: 'John',
          lastName: 'Doe',
          personalEmail: 'john@example.com',
          departmentId: 'dept-1',
          positionId: 'pos-1',
        }),
        'hr-1',
      );
      expect(offerRepository.confirmConversion).toHaveBeenCalledWith('org-1', 'offer-1', 'emp-1');
      expect(employeeOnboardingService.start).toHaveBeenCalledWith('org-1', 'emp-1');
      expect(applicationRepository.setStatus).toHaveBeenCalledWith('org-1', 'app-1', 'SELECTED');
      expect(result.wasNewConversion).toBe(true);
      expect(result.employee.id).toBe('emp-1');
    });

    it('404s when the application backing the offer has vanished', async () => {
      const { service, offerRepository, applicationRepository } = makeService();
      offerRepository.findById.mockResolvedValue(issuedOffer as never);
      offerRepository.claimAcceptance.mockResolvedValue({
        ...issuedOffer,
        status: 'ACCEPTED',
      } as never);
      applicationRepository.findByIdWithRelations.mockResolvedValue(null);

      await expect(service.accept('org-1', 'offer-1', 'hr-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('issue/decline/withdraw', () => {
    it('issue throws when the offer is not DRAFT', async () => {
      const { service, offerRepository } = makeService();
      offerRepository.issue.mockResolvedValue(null);

      await expect(service.issue('org-1', 'offer-1')).rejects.toThrow(BadRequestException);
    });

    it('decline throws when the offer is not ISSUED', async () => {
      const { service, offerRepository } = makeService();
      offerRepository.decline.mockResolvedValue(null);

      await expect(service.decline('org-1', 'offer-1')).rejects.toThrow(BadRequestException);
    });
  });
});
