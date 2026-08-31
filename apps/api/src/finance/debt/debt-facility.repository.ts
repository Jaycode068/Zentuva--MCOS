import { Injectable } from '@nestjs/common';
import {
  DebtFacility,
  DebtFacilityStatus,
  DebtRepaymentSchedule,
  DebtScheduleStatus,
  Prisma,
} from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { generateSchedule } from './repayment-schedule';

const FACILITY_CODE_PREFIX = 'DEBT';
const FACILITY_CODE_SEQUENCE_LENGTH = 6;

export interface ListDebtFacilitiesParams {
  status?: DebtFacilityStatus;
}

export interface OutstandingScheduleRow {
  debtFacilityId: string;
  facilityCode: string;
  facilityName: string;
  dueDate: Date;
  /** `totalDue − amountPaid`, always `> 0` for the rows this query returns. */
  remainingDue: number;
}

export interface CreateDebtFacilityData {
  organisationId: string;
  lenderId: string;
  name: string;
  debtType: DebtFacility['debtType'];
  principalAmount: number;
  currency: string;
  interestRatePercent: number;
  repaymentMethod: DebtFacility['repaymentMethod'];
  repaymentFrequency: DebtFacility['repaymentFrequency'];
  startDate: Date;
  tenorMonths: number;
  graceMonths: number;
  liabilityAccountId: string;
  interestExpenseAccountId: string;
  capitalRequirementId?: string;
  notes?: string;
  idempotencyKey?: string;
  createdById: string;
}

export interface CreateDebtFacilityResult {
  debtFacility: DebtFacility;
  wasCreated: boolean;
}

function addMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, date.getDate());
}

/**
 * Thin Prisma access for the `DebtFacility` aggregate (Sprint 17,
 * docs/domains/debt-management.md §6/§10) — the financing agreement itself.
 * Posts nothing (only `DebtDrawdown`/`DebtRepayment` touch the Ledger).
 * `create()` generates the full repayment schedule in the same transaction,
 * from the facility's own `principalAmount` (never recomputed per drawdown).
 */
@Injectable()
export class DebtFacilityRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(organisationId: string, id: string): Promise<DebtFacility | null> {
    return this.prisma.debtFacility.findFirst({ where: { id, organisationId } });
  }

  findManyByOrganisation(
    organisationId: string,
    params: ListDebtFacilitiesParams = {},
  ): Promise<DebtFacility[]> {
    return this.prisma.debtFacility.findMany({
      where: { organisationId, ...(params.status ? { status: params.status } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findSchedule(
    organisationId: string,
    debtFacilityId: string,
  ): Promise<DebtRepaymentSchedule[]> {
    await this.sweepOverdueSchedule(organisationId);
    return this.prisma.debtRepaymentSchedule.findMany({
      where: { debtFacilityId },
      orderBy: { installmentNumber: 'asc' },
    });
  }

  /** Lazy sweep mirroring `InvoiceRepository.sweepOverdue()` — no scheduler
   *  infrastructure. `OVERDUE` takes precedence over `SCHEDULED`/
   *  `PARTIALLY_PAID` in display once `dueDate` lapses; `PAID` rows are
   *  excluded (docs/domains/debt-management.md §16). */
  async sweepOverdueSchedule(organisationId: string): Promise<void> {
    await this.prisma.debtRepaymentSchedule.updateMany({
      where: {
        debtFacility: { organisationId },
        status: { in: [DebtScheduleStatus.SCHEDULED, DebtScheduleStatus.PARTIALLY_PAID] },
        dueDate: { lt: new Date() },
      },
      data: { status: DebtScheduleStatus.OVERDUE },
    });
  }

  /** Every unpaid installment for `ACTIVE`/`PARTIALLY_REPAID` facilities in
   *  this organisation — the raw material `CashflowForecastService` reads
   *  as `LOAN_REPAYMENT` outflow lines (docs/domains/debt-management.md
   *  "Cashflow Integration"). A `PROPOSED`/`APPROVED` facility's own
   *  schedule is deliberately excluded here — it contributes nothing to the
   *  live forecast until actually activated by a drawdown. */
  async findOutstandingScheduleForForecast(
    organisationId: string,
  ): Promise<OutstandingScheduleRow[]> {
    await this.sweepOverdueSchedule(organisationId);
    const rows = await this.prisma.debtRepaymentSchedule.findMany({
      where: {
        status: { not: DebtScheduleStatus.PAID },
        debtFacility: {
          organisationId,
          status: { in: [DebtFacilityStatus.ACTIVE, DebtFacilityStatus.PARTIALLY_REPAID] },
        },
      },
      include: { debtFacility: { select: { facilityCode: true, name: true } } },
      orderBy: { dueDate: 'asc' },
    });
    return rows
      .map((row) => ({
        debtFacilityId: row.debtFacilityId,
        facilityCode: row.debtFacility.facilityCode,
        facilityName: row.debtFacility.name,
        dueDate: row.dueDate,
        remainingDue: Math.round((row.totalDue - row.amountPaid) * 100) / 100,
      }))
      .filter((row) => row.remainingDue > 0);
  }

  async create(data: CreateDebtFacilityData): Promise<CreateDebtFacilityResult> {
    return this.prisma.$transaction(async (tx) => {
      if (data.idempotencyKey) {
        const existing = await tx.debtFacility.findUnique({
          where: {
            organisationId_idempotencyKey: {
              organisationId: data.organisationId,
              idempotencyKey: data.idempotencyKey,
            },
          },
        });
        if (existing) {
          return { debtFacility: existing, wasCreated: false };
        }
      }

      const facilityCode = await this.generateFacilityCode(tx, data.organisationId);
      const maturityDate = addMonths(data.startDate, data.tenorMonths);

      const debtFacility = await tx.debtFacility.create({
        data: {
          organisationId: data.organisationId,
          facilityCode,
          lenderId: data.lenderId,
          name: data.name,
          debtType: data.debtType,
          principalAmount: data.principalAmount,
          currency: data.currency,
          interestRatePercent: data.interestRatePercent,
          repaymentMethod: data.repaymentMethod,
          repaymentFrequency: data.repaymentFrequency,
          startDate: data.startDate,
          tenorMonths: data.tenorMonths,
          graceMonths: data.graceMonths,
          maturityDate,
          liabilityAccountId: data.liabilityAccountId,
          interestExpenseAccountId: data.interestExpenseAccountId,
          capitalRequirementId: data.capitalRequirementId,
          notes: data.notes,
          idempotencyKey: data.idempotencyKey,
          createdById: data.createdById,
        },
      });

      const installments = generateSchedule({
        principalAmount: data.principalAmount,
        interestRatePercent: data.interestRatePercent,
        tenorMonths: data.tenorMonths,
        graceMonths: data.graceMonths,
        repaymentMethod: data.repaymentMethod,
        repaymentFrequency: data.repaymentFrequency,
        startDate: data.startDate,
      });

      await tx.debtRepaymentSchedule.createMany({
        data: installments.map((installment) => ({
          debtFacilityId: debtFacility.id,
          installmentNumber: installment.installmentNumber,
          dueDate: installment.dueDate,
          openingPrincipal: installment.openingPrincipal,
          principalDue: installment.principalDue,
          interestDue: installment.interestDue,
          totalDue: installment.totalDue,
          closingPrincipal: installment.closingPrincipal,
        })),
      });

      return { debtFacility, wasCreated: true };
    });
  }

  update(
    organisationId: string,
    id: string,
    data: Prisma.DebtFacilityUncheckedUpdateInput,
  ): Promise<DebtFacility | null> {
    return this.updateMatching(organisationId, id, data);
  }

  private async updateMatching(
    organisationId: string,
    id: string,
    data: Prisma.DebtFacilityUncheckedUpdateInput,
  ): Promise<DebtFacility | null> {
    const result = await this.prisma.debtFacility.updateMany({
      where: { id, organisationId },
      data,
    });
    if (result.count === 0) {
      return null;
    }
    return this.prisma.debtFacility.findUniqueOrThrow({ where: { id } });
  }

  private async generateFacilityCode(
    tx: Prisma.TransactionClient,
    organisationId: string,
  ): Promise<string> {
    let sequence = 1;
    let candidate = this.formatFacilityCode(sequence);
    while (
      await tx.debtFacility.findUnique({
        where: { organisationId_facilityCode: { organisationId, facilityCode: candidate } },
        select: { id: true },
      })
    ) {
      sequence += 1;
      candidate = this.formatFacilityCode(sequence);
    }
    return candidate;
  }

  private formatFacilityCode(sequence: number): string {
    return `${FACILITY_CODE_PREFIX}-${String(sequence).padStart(FACILITY_CODE_SEQUENCE_LENGTH, '0')}`;
  }
}
