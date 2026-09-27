import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Employee, Offer } from '@prisma/client';
import { CreateOfferInput } from '@zentuva/validation';

import { EmployeeOnboardingService } from '../employee-onboarding.service';
import { EmployeeService } from '../employee.service';
import { ApplicationRepository } from './application.repository';
import { CreateOfferData, OfferRepository } from './offer.repository';

export interface AcceptOfferResult {
  offer: Offer;
  employee: Employee;
  wasNewConversion: boolean;
}

/**
 * Sprint 30 — Recruitment & Candidate Interview Management Foundation
 * (recruitment.md §"Candidate → Employee → Onboarding"). Chosen transition
 * point, documented per the brief's own explicit requirement to pick and
 * document ONE model: the `Employee` is created at the moment HR records an
 * offer as ACCEPTED, inside `accept()`, reusing `EmployeeService.create()`
 * and `EmployeeOnboardingService.start()` completely unchanged — no
 * duplicate onboarding model, no duplicate employee model. No `User` account
 * is ever auto-created (brief §31) — `Employee.userId` stays null;
 * provisioning a login remains the existing separate administrative step
 * (`EmployeeController`'s own `linkUser` action).
 */
@Injectable()
export class OfferService {
  constructor(
    private readonly offerRepository: OfferRepository,
    private readonly applicationRepository: ApplicationRepository,
    private readonly employeeService: EmployeeService,
    private readonly employeeOnboardingService: EmployeeOnboardingService,
  ) {}

  async getById(organisationId: string, id: string): Promise<Offer> {
    const offer = await this.offerRepository.findById(organisationId, id);
    if (!offer) {
      throw new NotFoundException('Offer not found');
    }
    return offer;
  }

  listByApplication(organisationId: string, applicationId: string) {
    return this.offerRepository.listByApplication(organisationId, applicationId);
  }

  list(organisationId: string, status?: Offer['status']) {
    return this.offerRepository.list(organisationId, status);
  }

  async create(
    organisationId: string,
    applicationId: string,
    input: CreateOfferInput,
    issuedByUserId: string,
  ): Promise<Offer> {
    const application = await this.applicationRepository.findById(organisationId, applicationId);
    if (!application) {
      throw new NotFoundException('Application not found');
    }

    const data: CreateOfferData = {
      organisationId,
      applicationId,
      proposedSalary: input.proposedSalary,
      employmentType: input.employmentType,
      proposedStartDate: input.proposedStartDate,
      expiryDate: input.expiryDate,
      notes: input.notes,
      issuedByUserId,
    };
    const created = await this.offerRepository.create(data);
    if (!created) {
      throw new BadRequestException(
        'This application already has an active (draft or issued) offer',
      );
    }
    return created;
  }

  async issue(organisationId: string, id: string): Promise<Offer> {
    const updated = await this.offerRepository.issue(organisationId, id);
    if (!updated) {
      throw new BadRequestException('Offer must be DRAFT to issue');
    }
    return updated;
  }

  async decline(organisationId: string, id: string, notes?: string): Promise<Offer> {
    const updated = await this.offerRepository.decline(organisationId, id, notes);
    if (!updated) {
      throw new BadRequestException('Offer must be ISSUED to decline');
    }
    return updated;
  }

  async withdraw(organisationId: string, id: string): Promise<Offer> {
    const updated = await this.offerRepository.withdraw(organisationId, id);
    if (!updated) {
      throw new BadRequestException('Offer cannot be withdrawn from its current status');
    }
    return updated;
  }

  /** Accept + convert, atomically guarded against creating duplicate
   *  `Employee` rows under concurrent acceptance (recruitment.md §"Employee
   *  Creation", brief §43/§50) — `claimAcceptance` is called FIRST, and only
   *  the request that actually WINS that conditional `ISSUED → ACCEPTED`
   *  claim goes on to create an `Employee` at all; a losing concurrent
   *  request never creates one, so there is never an orphan row to clean up.
   *  If the offer is already `ACCEPTED` with a `convertedEmployeeId` set,
   *  this is a duplicate/retried call — returns the EXISTING employee
   *  (`wasNewConversion: false`), never throwing on a harmless replay. */
  async accept(
    organisationId: string,
    id: string,
    actorUserId: string,
  ): Promise<AcceptOfferResult> {
    const offer = await this.getById(organisationId, id);
    if (offer.status === 'ACCEPTED' && offer.convertedEmployeeId) {
      const employee = await this.employeeService.getById(
        organisationId,
        offer.convertedEmployeeId,
      );
      return { offer, employee, wasNewConversion: false };
    }

    const claimed = await this.offerRepository.claimAcceptance(organisationId, id);
    if (!claimed) {
      throw new BadRequestException('Offer must be ISSUED to accept');
    }

    const application = await this.applicationRepository.findByIdWithRelations(
      organisationId,
      offer.applicationId,
    );
    if (!application) {
      throw new NotFoundException('Application not found');
    }

    const employee = await this.employeeService.create(
      organisationId,
      {
        firstName: application.candidate.firstName,
        lastName: application.candidate.lastName,
        personalEmail: application.candidate.email,
        phoneNumber: application.candidate.phone ?? undefined,
        departmentId: application.vacancy.departmentId ?? undefined,
        positionId: application.vacancy.positionId,
        employmentType: offer.employmentType,
        hireDate: offer.proposedStartDate ?? new Date(),
      },
      actorUserId,
    );

    const converted = await this.offerRepository.confirmConversion(organisationId, id, employee.id);

    await this.employeeOnboardingService.start(organisationId, employee.id);
    await this.applicationRepository.setStatus(organisationId, offer.applicationId, 'SELECTED');

    return { offer: converted ?? claimed, employee, wasNewConversion: true };
  }
}
