import { Injectable, NotFoundException } from '@nestjs/common';
import { DebtFacilityStatus, DebtScheduleStatus } from '@prisma/client';

import { CashflowForecastService } from '../cashflow/cashflow-forecast.service';
import { CashflowSettingsService } from '../cashflow/cashflow-settings.service';
import { PrismaService } from '../../prisma/prisma.service';
import { computeDebtBalance } from './debt-balance';
import { DebtFacilityRepository } from './debt-facility.repository';

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface FacilityImpactPeriod {
  periodStart: Date;
  periodEnd: Date;
  label: string;
  baseClosingBalance: number;
  additionalDebtService: number;
  projectedClosingBalance: number;
  belowMinimumReserve: boolean;
}

export interface FacilityImpactResult {
  facilityAlreadyActive: boolean;
  minimumCashReserve: number;
  periods: FacilityImpactPeriod[];
  /** A planning signal only — never a verdict (docs/domains/
   *  debt-management.md §23: "never claim a loan is safe"). */
  potentialCashflowPressure: boolean;
}

export interface DebtMetrics {
  facilityCount: number;
  totalOutstanding: number;
  outstandingPrincipal: number;
  outstandingInterest: number;
  upcomingRepayments30Days: number;
  monthlyDebtService: number;
  totalInterestScheduled: number;
  nextMaturity: Date | null;
}

/**
 * Financing Analysis Foundation (Sprint 17, docs/domains/debt-management.md
 * §9/§23/§24/§25) — genuinely reuses Sprint 15's `CashflowForecastService`
 * for scenario preview rather than a second forecast engine. A `PROPOSED`/
 * `APPROVED` facility contributes nothing to the *real* live forecast
 * (`CashflowForecastService` only reads `ACTIVE`/`PARTIALLY_REPAID`
 * schedules) — this service overlays that one facility's own schedule on
 * top of the real forecast to preview "what if we activated this," without
 * ever claiming the result is a recommendation.
 */
@Injectable()
export class DebtAnalysisService {
  constructor(
    private readonly debtFacilityRepository: DebtFacilityRepository,
    private readonly cashflowForecastService: CashflowForecastService,
    private readonly cashflowSettingsService: CashflowSettingsService,
    private readonly prisma: PrismaService,
  ) {}

  async previewFacilityImpact(
    organisationId: string,
    facilityId: string,
    params: { cashflowScenarioId?: string } = {},
  ): Promise<FacilityImpactResult> {
    const facility = await this.debtFacilityRepository.findById(organisationId, facilityId);
    if (!facility) {
      throw new NotFoundException('Debt facility not found');
    }

    const today = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
    const horizonDays = Math.max(
      1,
      Math.min(
        730,
        Math.ceil((facility.maturityDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000)),
      ),
    );

    const [forecast, settings] = await Promise.all([
      this.cashflowForecastService.getForecast(organisationId, {
        horizonDays,
        bucketBy: 'monthly',
        scenarioId: params.cashflowScenarioId,
      }),
      this.cashflowSettingsService.getEffective(organisationId),
    ]);

    const facilityAlreadyActive =
      facility.status === DebtFacilityStatus.ACTIVE ||
      facility.status === DebtFacilityStatus.PARTIALLY_REPAID;

    let schedule: { dueDate: Date; totalDue: number; amountPaid: number }[] = [];
    if (!facilityAlreadyActive) {
      schedule = await this.debtFacilityRepository.findSchedule(organisationId, facilityId);
    }

    let potentialCashflowPressure = false;
    const periods: FacilityImpactPeriod[] = forecast.buckets.map((bucket) => {
      const additionalDebtService = facilityAlreadyActive
        ? 0
        : roundCurrency(
            schedule
              .filter((row) => row.dueDate >= bucket.periodStart && row.dueDate <= bucket.periodEnd)
              .reduce((sum, row) => sum + Math.max(0, row.totalDue - row.amountPaid), 0),
          );
      const projectedClosingBalance = roundCurrency(bucket.closingBalance - additionalDebtService);
      const belowMinimumReserve = projectedClosingBalance < settings.minimumCashReserve;
      if (belowMinimumReserve) {
        potentialCashflowPressure = true;
      }
      return {
        periodStart: bucket.periodStart,
        periodEnd: bucket.periodEnd,
        label: bucket.label,
        baseClosingBalance: bucket.closingBalance,
        additionalDebtService,
        projectedClosingBalance,
        belowMinimumReserve,
      };
    });

    return {
      facilityAlreadyActive,
      minimumCashReserve: settings.minimumCashReserve,
      periods,
      potentialCashflowPressure,
    };
  }

  async getDebtMetrics(organisationId: string): Promise<DebtMetrics> {
    const [activeFacilities, partiallyRepaidFacilities] = await Promise.all([
      this.debtFacilityRepository.findManyByOrganisation(organisationId, {
        status: DebtFacilityStatus.ACTIVE,
      }),
      this.debtFacilityRepository.findManyByOrganisation(organisationId, {
        status: DebtFacilityStatus.PARTIALLY_REPAID,
      }),
    ]);
    const liveFacilities = [...activeFacilities, ...partiallyRepaidFacilities];

    if (liveFacilities.length === 0) {
      return {
        facilityCount: 0,
        totalOutstanding: 0,
        outstandingPrincipal: 0,
        outstandingInterest: 0,
        upcomingRepayments30Days: 0,
        monthlyDebtService: 0,
        totalInterestScheduled: 0,
        nextMaturity: null,
      };
    }

    await this.debtFacilityRepository.sweepOverdueSchedule(organisationId);

    const today = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
    const in30Days = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);

    let totalOutstanding = 0;
    let outstandingPrincipal = 0;
    let outstandingInterest = 0;
    let upcomingRepayments30Days = 0;
    let monthlyDebtService = 0;
    let totalInterestScheduled = 0;
    let nextMaturity: Date | null = null;

    for (const facility of liveFacilities) {
      const [balance, schedule] = await Promise.all([
        computeDebtBalance(this.prisma, facility.id),
        this.debtFacilityRepository.findSchedule(organisationId, facility.id),
      ]);
      totalOutstanding += balance.totalOutstanding;
      outstandingPrincipal += balance.outstandingPrincipal;
      outstandingInterest += balance.outstandingInterest;
      totalInterestScheduled += schedule.reduce((sum, row) => sum + row.interestDue, 0);

      const unpaid = schedule.filter((row) => row.status !== DebtScheduleStatus.PAID);
      upcomingRepayments30Days += unpaid
        .filter((row) => row.dueDate <= in30Days)
        .reduce((sum, row) => sum + Math.max(0, row.totalDue - row.amountPaid), 0);

      const nextInstallment = unpaid.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())[0];
      if (nextInstallment) {
        monthlyDebtService += Math.max(0, nextInstallment.totalDue - nextInstallment.amountPaid);
      }

      if (!nextMaturity || facility.maturityDate < nextMaturity) {
        nextMaturity = facility.maturityDate;
      }
    }

    return {
      facilityCount: liveFacilities.length,
      totalOutstanding: roundCurrency(totalOutstanding),
      outstandingPrincipal: roundCurrency(outstandingPrincipal),
      outstandingInterest: roundCurrency(outstandingInterest),
      upcomingRepayments30Days: roundCurrency(upcomingRepayments30Days),
      monthlyDebtService: roundCurrency(monthlyDebtService),
      totalInterestScheduled: roundCurrency(totalInterestScheduled),
      nextMaturity,
    };
  }
}
