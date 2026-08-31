import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AccountType,
  DebtFacility,
  DebtFacilityStatus,
  DebtRepaymentSchedule,
} from '@prisma/client';
import { CreateDebtFacilityInput, UpdateDebtFacilityInput } from '@zentuva/validation';

import { ChartOfAccountRepository } from '../accounting/chart-of-account.repository';
import { CapitalRequirementRepository } from './capital-requirement.repository';
import { computeDebtBalance, DebtBalance } from './debt-balance';
import {
  CreateDebtFacilityResult,
  DebtFacilityRepository,
  ListDebtFacilitiesParams,
} from './debt-facility.repository';
import { LenderRepository } from './lender.repository';
import { PrismaService } from '../../prisma/prisma.service';

/** Domain service for the `DebtFacility` aggregate (Sprint 17,
 *  docs/domains/debt-management.md §6/§12) — account/lender validation,
 *  lifecycle guards, and the live balance computation. Automatic status
 *  transitions (`ACTIVE`/`PARTIALLY_REPAID`/`PAID_OFF`) live in
 *  `debt-drawdown.repository.ts`/`debt-repayment.repository.ts` themselves,
 *  inside the same transaction as the event that triggers them. */
@Injectable()
export class DebtFacilityService {
  constructor(
    private readonly debtFacilityRepository: DebtFacilityRepository,
    private readonly lenderRepository: LenderRepository,
    private readonly chartOfAccountRepository: ChartOfAccountRepository,
    private readonly capitalRequirementRepository: CapitalRequirementRepository,
    private readonly prisma: PrismaService,
  ) {}

  getById(organisationId: string, id: string): Promise<DebtFacility> {
    return this.getByIdOrThrow(organisationId, id);
  }

  list(organisationId: string, params?: ListDebtFacilitiesParams): Promise<DebtFacility[]> {
    return this.debtFacilityRepository.findManyByOrganisation(organisationId, params);
  }

  async getSchedule(organisationId: string, id: string): Promise<DebtRepaymentSchedule[]> {
    await this.getByIdOrThrow(organisationId, id);
    return this.debtFacilityRepository.findSchedule(organisationId, id);
  }

  async getBalance(organisationId: string, id: string): Promise<DebtBalance> {
    await this.getByIdOrThrow(organisationId, id);
    return computeDebtBalance(this.prisma, id);
  }

  async create(
    organisationId: string,
    input: CreateDebtFacilityInput,
    actorUserId: string,
  ): Promise<CreateDebtFacilityResult> {
    const lender = await this.lenderRepository.findById(organisationId, input.lenderId);
    if (!lender) {
      throw new NotFoundException('Lender not found');
    }

    await this.assertAccountEligible(
      organisationId,
      input.liabilityAccountId,
      AccountType.LIABILITY,
    );
    await this.assertAccountEligible(
      organisationId,
      input.interestExpenseAccountId,
      AccountType.EXPENSE,
    );

    if (input.capitalRequirementId) {
      const requirement = await this.capitalRequirementRepository.findById(
        organisationId,
        input.capitalRequirementId,
      );
      if (!requirement) {
        throw new NotFoundException('Capital requirement not found');
      }
    }

    return this.debtFacilityRepository.create({
      organisationId,
      lenderId: input.lenderId,
      name: input.name,
      debtType: input.debtType,
      principalAmount: input.principalAmount,
      currency: input.currency,
      interestRatePercent: input.interestRatePercent,
      repaymentMethod: input.repaymentMethod,
      repaymentFrequency: input.repaymentFrequency,
      startDate: input.startDate,
      tenorMonths: input.tenorMonths,
      graceMonths: input.graceMonths,
      liabilityAccountId: input.liabilityAccountId,
      interestExpenseAccountId: input.interestExpenseAccountId,
      capitalRequirementId: input.capitalRequirementId,
      notes: input.notes,
      idempotencyKey: input.idempotencyKey,
      createdById: actorUserId,
    });
  }

  async update(
    organisationId: string,
    id: string,
    input: UpdateDebtFacilityInput,
  ): Promise<DebtFacility> {
    const facility = await this.getByIdOrThrow(organisationId, id);
    if (facility.status !== DebtFacilityStatus.PROPOSED) {
      throw new BadRequestException('Only a proposed facility can be edited directly');
    }
    if (input.capitalRequirementId) {
      const requirement = await this.capitalRequirementRepository.findById(
        organisationId,
        input.capitalRequirementId,
      );
      if (!requirement) {
        throw new NotFoundException('Capital requirement not found');
      }
    }
    const updated = await this.debtFacilityRepository.update(organisationId, id, {
      name: input.name,
      notes: input.notes,
      capitalRequirementId: input.capitalRequirementId,
    });
    if (!updated) {
      throw new NotFoundException('Debt facility not found');
    }
    return updated;
  }

  async approve(organisationId: string, id: string, actorUserId: string): Promise<DebtFacility> {
    const facility = await this.getByIdOrThrow(organisationId, id);
    if (facility.status !== DebtFacilityStatus.PROPOSED) {
      throw new BadRequestException('Only a proposed facility can be approved');
    }
    const updated = await this.debtFacilityRepository.update(organisationId, id, {
      status: DebtFacilityStatus.APPROVED,
      approvedById: actorUserId,
      approvedAt: new Date(),
    });
    if (!updated) {
      throw new NotFoundException('Debt facility not found');
    }
    return updated;
  }

  async cancel(organisationId: string, id: string): Promise<DebtFacility> {
    const facility = await this.getByIdOrThrow(organisationId, id);
    if (
      facility.status !== DebtFacilityStatus.PROPOSED &&
      facility.status !== DebtFacilityStatus.APPROVED
    ) {
      throw new BadRequestException(
        'A facility can only be cancelled while proposed or approved — never once drawn',
      );
    }
    const updated = await this.debtFacilityRepository.update(organisationId, id, {
      status: DebtFacilityStatus.CANCELLED,
      cancelledAt: new Date(),
    });
    if (!updated) {
      throw new NotFoundException('Debt facility not found');
    }
    return updated;
  }

  /** No automatic default-detection engine (brief §38 — "not a full
   *  collections system") — a manual, Owner/Administrator-only flag. */
  async markDefaulted(organisationId: string, id: string): Promise<DebtFacility> {
    const facility = await this.getByIdOrThrow(organisationId, id);
    if (
      facility.status === DebtFacilityStatus.CANCELLED ||
      facility.status === DebtFacilityStatus.PAID_OFF ||
      facility.status === DebtFacilityStatus.DEFAULTED
    ) {
      throw new BadRequestException(
        `A ${facility.status.toLowerCase()} facility cannot be marked defaulted`,
      );
    }
    const updated = await this.debtFacilityRepository.update(organisationId, id, {
      status: DebtFacilityStatus.DEFAULTED,
      defaultedAt: new Date(),
    });
    if (!updated) {
      throw new NotFoundException('Debt facility not found');
    }
    return updated;
  }

  private async assertAccountEligible(
    organisationId: string,
    accountId: string,
    expectedType: AccountType,
  ): Promise<void> {
    const account = await this.chartOfAccountRepository.findById(organisationId, accountId);
    if (!account) {
      throw new NotFoundException('Chart of account not found');
    }
    if (account.type !== expectedType) {
      throw new BadRequestException(`This account must be a ${expectedType} account`);
    }
    if (account.isSystemAccount) {
      throw new BadRequestException('A system account cannot be used here');
    }
  }

  private async getByIdOrThrow(organisationId: string, id: string): Promise<DebtFacility> {
    const facility = await this.debtFacilityRepository.findById(organisationId, id);
    if (!facility) {
      throw new NotFoundException('Debt facility not found');
    }
    return facility;
  }
}
