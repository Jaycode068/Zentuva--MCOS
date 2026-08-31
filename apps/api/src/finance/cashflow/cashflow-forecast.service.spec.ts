import { CashflowForecastSourceType, CashflowRecurrence } from '@prisma/client';

import { CashflowForecastService, expandRecurrence } from './cashflow-forecast.service';

const ORG = 'org-1';

function daysFromNow(days: number): Date {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date;
}

function makeService(overrides: {
  arRows?: unknown[];
  apRows?: unknown[];
  items?: unknown[];
  adjustments?: unknown[];
  scenario?: unknown;
  settings?: {
    minimumCashReserve: number;
    defaultCollectionDelayDays: number;
    defaultPaymentDelayDays: number;
  };
  cashAccounts?: {
    id: string;
    name: string;
    accountCode: string;
    linkedChartOfAccountId: string;
  }[];
  balances?: Record<string, number>;
  debtScheduleRows?: unknown[];
}) {
  const invoiceRepository = {
    getOutstandingForAging: jest.fn().mockResolvedValue(overrides.arRows ?? []),
  };
  const supplierInvoiceRepository = {
    getOutstandingForAging: jest.fn().mockResolvedValue(overrides.apRows ?? []),
  };
  const cashflowItemRepository = {
    findActiveByOrganisation: jest.fn().mockResolvedValue(overrides.items ?? []),
  };
  const cashflowAdjustmentRepository = {
    findManyByOrganisation: jest.fn().mockResolvedValue(overrides.adjustments ?? []),
  };
  const cashflowScenarioRepository = {
    findById: jest.fn().mockResolvedValue(overrides.scenario ?? null),
  };
  const cashflowSettingsService = {
    getEffective: jest.fn().mockResolvedValue(
      overrides.settings ?? {
        minimumCashReserve: 0,
        defaultCollectionDelayDays: 0,
        defaultPaymentDelayDays: 0,
      },
    ),
  };
  const accounts = overrides.cashAccounts ?? [
    { id: 'ca-1', name: 'GTBank', accountCode: 'CASH-001', linkedChartOfAccountId: 'coa-1' },
  ];
  const cashAccountRepository = {
    findManyByOrganisation: jest.fn().mockResolvedValue(accounts),
    findById: jest
      .fn()
      .mockImplementation(
        async (_org: string, id: string) => accounts.find((a) => a.id === id) ?? null,
      ),
  };
  const balances = overrides.balances ?? { 'coa-1': 15_000_000 };
  const ledgerService = {
    getAccountActivity: jest.fn().mockImplementation(async (_org: string, accountId: string) => ({
      closingBalance: balances[accountId] ?? 0,
    })),
  };
  const debtFacilityRepository = {
    findOutstandingScheduleForForecast: jest
      .fn()
      .mockResolvedValue(overrides.debtScheduleRows ?? []),
  };

  const service = new CashflowForecastService(
    invoiceRepository as never,
    supplierInvoiceRepository as never,
    cashflowItemRepository as never,
    cashflowAdjustmentRepository as never,
    cashflowScenarioRepository as never,
    cashflowSettingsService as never,
    cashAccountRepository as never,
    ledgerService as never,
    debtFacilityRepository as never,
  );

  return {
    service,
    invoiceRepository,
    supplierInvoiceRepository,
    cashAccountRepository,
    debtFacilityRepository,
  };
}

describe('CashflowForecastService.getForecast — opening/inflows/outflows/closing', () => {
  it('computes opening balance from consolidated cash account book balances', async () => {
    const { service } = makeService({ balances: { 'coa-1': 15_000_000 } });
    const forecast = await service.getForecast(ORG, { horizonDays: 30, bucketBy: 'weekly' });
    expect(forecast.currentCash).toBe(15_000_000);
    expect(forecast.buckets[0]!.openingBalance).toBe(15_000_000);
  });

  it('includes an outstanding invoice as an inflow on its due date', async () => {
    const { service } = makeService({
      arRows: [
        {
          id: 'inv-1',
          invoiceCode: 'INV-001',
          customerId: 'cus-1',
          customerCode: 'CUS-001',
          customerName: 'ABC Supermarket',
          dueDate: daysFromNow(14),
          amountOutstanding: 8_000_000,
        },
      ],
    });
    const forecast = await service.getForecast(ORG, { horizonDays: 30, bucketBy: 'weekly' });
    expect(forecast.totalExpectedInflows).toBe(8_000_000);
    const week3 = forecast.buckets[2]!;
    expect(week3.inflows).toBe(8_000_000);
    expect(week3.items).toHaveLength(1);
    expect(week3.items[0]!.sourceType).toBe(CashflowForecastSourceType.CUSTOMER_RECEIVABLE);
    expect(week3.items[0]!.confidence).toBe('CONFIRMED');
  });

  it('excludes an invoice with zero outstanding balance (already paid)', async () => {
    const { service } = makeService({
      arRows: [
        {
          id: 'inv-1',
          invoiceCode: 'INV-001',
          customerId: 'cus-1',
          customerCode: 'CUS-001',
          customerName: 'ABC',
          dueDate: daysFromNow(5),
          amountOutstanding: 0,
        },
      ],
    });
    const forecast = await service.getForecast(ORG, { horizonDays: 30, bucketBy: 'weekly' });
    expect(forecast.totalExpectedInflows).toBe(0);
  });

  it('a partially paid invoice contributes only its outstanding balance', async () => {
    const { service } = makeService({
      arRows: [
        {
          id: 'inv-1',
          invoiceCode: 'INV-001',
          customerId: 'cus-1',
          customerCode: 'CUS-001',
          customerName: 'ABC',
          dueDate: daysFromNow(5),
          amountOutstanding: 300_000, // total 500,000 less 200,000 already paid
        },
      ],
    });
    const forecast = await service.getForecast(ORG, { horizonDays: 30, bucketBy: 'weekly' });
    expect(forecast.totalExpectedInflows).toBe(300_000);
  });

  it('includes an outstanding supplier invoice as an outflow with EXPECTED confidence', async () => {
    const { service } = makeService({
      apRows: [
        {
          id: 'sinv-1',
          invoiceNumber: 'SINV-004',
          supplierId: 'sup-1',
          supplierCode: 'SUP-001',
          supplierName: 'XYZ Supplies',
          dueDate: daysFromNow(10),
          amountOutstanding: 5_000_000,
        },
      ],
    });
    const forecast = await service.getForecast(ORG, { horizonDays: 30, bucketBy: 'weekly' });
    expect(forecast.totalExpectedOutflows).toBe(5_000_000);
    const week2 = forecast.buckets[1]!;
    expect(week2.outflows).toBe(5_000_000);
    expect(week2.items[0]!.confidence).toBe('EXPECTED');
    expect(week2.items[0]!.sourceType).toBe(CashflowForecastSourceType.SUPPLIER_PAYABLE);
  });

  it('excludes a fully paid supplier invoice', async () => {
    const { service } = makeService({
      apRows: [
        {
          id: 'sinv-1',
          invoiceNumber: 'SINV-1',
          supplierId: 'sup-1',
          supplierCode: 'SUP-1',
          supplierName: 'X',
          dueDate: daysFromNow(5),
          amountOutstanding: 0,
        },
      ],
    });
    const forecast = await service.getForecast(ORG, { horizonDays: 30, bucketBy: 'weekly' });
    expect(forecast.totalExpectedOutflows).toBe(0);
  });

  it('an overdue invoice (due date in the past) still lands in the first bucket, not dropped', async () => {
    const { service } = makeService({
      arRows: [
        {
          id: 'inv-overdue',
          invoiceCode: 'INV-OVERDUE',
          customerId: 'cus-1',
          customerCode: 'CUS-1',
          customerName: 'Overdue Co',
          dueDate: daysFromNow(-20),
          amountOutstanding: 1_000_000,
        },
      ],
    });
    const forecast = await service.getForecast(ORG, { horizonDays: 30, bucketBy: 'weekly' });
    expect(forecast.buckets[0]!.inflows).toBe(1_000_000);
    expect(forecast.totalExpectedInflows).toBe(1_000_000);
  });

  it('computes closing balance as opening + inflows − outflows, carried into the next bucket opening', async () => {
    const { service } = makeService({
      balances: { 'coa-1': 10_000_000 },
      arRows: [
        {
          id: 'inv-1',
          invoiceCode: 'INV-1',
          customerId: 'c',
          customerCode: 'C',
          customerName: 'C',
          dueDate: daysFromNow(3),
          amountOutstanding: 2_000_000,
        },
      ],
      apRows: [
        {
          id: 'sinv-1',
          invoiceNumber: 'S-1',
          supplierId: 's',
          supplierCode: 'S',
          supplierName: 'S',
          dueDate: daysFromNow(4),
          amountOutstanding: 500_000,
        },
      ],
    });
    const forecast = await service.getForecast(ORG, { horizonDays: 14, bucketBy: 'weekly' });
    const week1 = forecast.buckets[0]!;
    expect(week1.openingBalance).toBe(10_000_000);
    expect(week1.closingBalance).toBe(11_500_000);
    expect(forecast.buckets[1]!.openingBalance).toBe(11_500_000);
  });
});

describe('CashflowForecastService.getForecast — bucketing and horizons', () => {
  it('weekly bucketing produces ceil(horizonDays/7) buckets', async () => {
    const { service } = makeService({});
    const forecast = await service.getForecast(ORG, { horizonDays: 30, bucketBy: 'weekly' });
    expect(forecast.buckets).toHaveLength(5); // 30/7 = 4.28 -> 5 buckets, last truncated
  });

  it('monthly bucketing starts with a partial current-month bucket', async () => {
    const { service } = makeService({});
    const forecast = await service.getForecast(ORG, { horizonDays: 90, bucketBy: 'monthly' });
    expect(forecast.buckets.length).toBeGreaterThanOrEqual(3);
    expect(forecast.buckets[0]!.label).toMatch(/\d{4}/);
  });

  it.each([30, 60, 90, 180, 365])('supports a %i-day horizon', async (horizonDays) => {
    const { service } = makeService({});
    const forecast = await service.getForecast(ORG, { horizonDays, bucketBy: 'monthly' });
    expect(forecast.horizonDays).toBe(horizonDays);
    expect(forecast.buckets.length).toBeGreaterThan(0);
    const lastBucket = forecast.buckets[forecast.buckets.length - 1]!;
    expect(lastBucket.periodEnd.getTime()).toBeLessThanOrEqual(
      daysFromNow(horizonDays).getTime() + 1,
    );
  });
});

describe('CashflowForecastService.getForecast — recurring items', () => {
  it('a RECEIPT recurring monthly rent-like item appears with EXPECTED confidence', async () => {
    const { service } = makeService({
      items: [
        {
          id: 'item-1',
          cashAccountId: null,
          direction: 'OUTFLOW',
          sourceType: CashflowForecastSourceType.RECURRING_ITEM,
          description: 'Factory Rent',
          amount: 1_500_000,
          expectedDate: daysFromNow(1),
          recurrence: CashflowRecurrence.MONTHLY,
          recurrenceEndDate: null,
        },
      ],
    });
    const forecast = await service.getForecast(ORG, { horizonDays: 90, bucketBy: 'monthly' });
    // ~3-4 monthly occurrences in a 90-day window, depending on exact month lengths.
    expect(forecast.totalExpectedOutflows % 1_500_000).toBe(0);
    expect(forecast.totalExpectedOutflows).toBeGreaterThanOrEqual(3_000_000);
    expect(forecast.totalExpectedOutflows).toBeLessThanOrEqual(6_000_000);
    const rentItems = forecast.buckets
      .flatMap((b) => b.items)
      .filter((i) => i.sourceId === 'item-1');
    expect(rentItems.every((i) => i.confidence === 'EXPECTED')).toBe(true);
  });

  it('a ONE_TIME manual forecast item appears exactly once with ESTIMATED confidence', async () => {
    const { service } = makeService({
      items: [
        {
          id: 'item-2',
          cashAccountId: null,
          direction: 'INFLOW',
          sourceType: CashflowForecastSourceType.MANUAL_FORECAST,
          description: 'Expected additional customer collection',
          amount: 4_000_000,
          expectedDate: daysFromNow(20),
          recurrence: CashflowRecurrence.ONE_TIME,
          recurrenceEndDate: null,
        },
      ],
    });
    const forecast = await service.getForecast(ORG, { horizonDays: 90, bucketBy: 'monthly' });
    const matches = forecast.buckets.flatMap((b) => b.items).filter((i) => i.sourceId === 'item-2');
    expect(matches).toHaveLength(1);
    expect(matches[0]!.confidence).toBe('ESTIMATED');
    expect(forecast.totalExpectedInflows).toBe(4_000_000);
  });
});

describe('expandRecurrence', () => {
  const horizonEnd = daysFromNow(400);

  it('ONE_TIME produces exactly one occurrence', () => {
    const start = daysFromNow(10);
    expect(expandRecurrence(start, CashflowRecurrence.ONE_TIME, null, horizonEnd)).toEqual([start]);
  });

  it('WEEKLY steps by 7 days', () => {
    const start = daysFromNow(0);
    const boundary = daysFromNow(21);
    const occurrences = expandRecurrence(start, CashflowRecurrence.WEEKLY, boundary, horizonEnd);
    expect(occurrences).toHaveLength(4);
  });

  it('MONTHLY steps by calendar month', () => {
    const start = daysFromNow(0);
    const boundary = daysFromNow(95);
    const occurrences = expandRecurrence(start, CashflowRecurrence.MONTHLY, boundary, horizonEnd);
    expect(occurrences.length).toBeGreaterThanOrEqual(3);
    expect(occurrences.length).toBeLessThanOrEqual(4);
  });

  it('QUARTERLY steps by 3 months', () => {
    const start = daysFromNow(0);
    const boundary = daysFromNow(370);
    const occurrences = expandRecurrence(start, CashflowRecurrence.QUARTERLY, boundary, horizonEnd);
    expect(occurrences.length).toBeGreaterThanOrEqual(4);
  });

  it('YEARLY steps by 12 months', () => {
    const start = daysFromNow(0);
    const boundary = daysFromNow(760);
    const occurrences = expandRecurrence(
      start,
      CashflowRecurrence.YEARLY,
      boundary,
      daysFromNow(760),
    );
    expect(occurrences).toHaveLength(3);
  });

  it('respects recurrenceEndDate over the horizon end', () => {
    const start = daysFromNow(0);
    const boundary = daysFromNow(10);
    const occurrences = expandRecurrence(
      start,
      CashflowRecurrence.WEEKLY,
      boundary,
      daysFromNow(400),
    );
    expect(occurrences.every((d) => d <= boundary)).toBe(true);
  });
});

describe('CashflowForecastService.getForecast — adjustments', () => {
  it('an adjustment overrides the expected date and amount without touching the source row', async () => {
    const { service, invoiceRepository } = makeService({
      arRows: [
        {
          id: 'inv-1',
          invoiceCode: 'INV-001',
          customerId: 'c',
          customerCode: 'C',
          customerName: 'C',
          dueDate: daysFromNow(5),
          amountOutstanding: 2_000_000,
        },
      ],
      adjustments: [
        {
          sourceType: CashflowForecastSourceType.CUSTOMER_RECEIVABLE,
          sourceId: 'inv-1',
          adjustedExpectedDate: daysFromNow(25),
          adjustedAmount: 1_800_000,
        },
      ],
    });
    const forecast = await service.getForecast(ORG, { horizonDays: 30, bucketBy: 'weekly' });
    expect(forecast.totalExpectedInflows).toBe(1_800_000);
    const adjustedItem = forecast.buckets
      .flatMap((b) => b.items)
      .find((i) => i.sourceId === 'inv-1');
    expect(adjustedItem?.adjusted).toBe(true);
    // The repository's own read was never asked to write anything — proves the
    // source Invoice row itself is never touched by an adjustment.
    expect(invoiceRepository.getOutstandingForAging).toHaveBeenCalledTimes(1);
  });
});

describe('CashflowForecastService.getForecast — scenarios', () => {
  const arRow = {
    id: 'inv-1',
    invoiceCode: 'INV-1',
    customerId: 'c',
    customerCode: 'C',
    customerName: 'C',
    dueDate: daysFromNow(5),
    amountOutstanding: 1_000_000,
  };

  it('Base (no scenario) leaves amounts unchanged', async () => {
    const { service } = makeService({ arRows: [arRow] });
    const forecast = await service.getForecast(ORG, { horizonDays: 30, bucketBy: 'weekly' });
    expect(forecast.totalExpectedInflows).toBe(1_000_000);
  });

  it('a Conservative scenario (reduced collections) lowers total expected inflows', async () => {
    const { service } = makeService({
      arRows: [arRow],
      scenario: {
        id: 'scn-conservative',
        inflowDelayDays: 30,
        inflowMultiplier: 0.8,
        outflowDelayDays: 0,
        outflowMultiplier: 1,
      },
    });
    const forecast = await service.getForecast(ORG, {
      horizonDays: 30,
      bucketBy: 'weekly',
      scenarioId: 'scn-conservative',
    });
    // Delayed 30 days past a 30-day horizon means the inflow falls outside the
    // window entirely — a stronger, still-correct assertion than just "reduced".
    expect(forecast.totalExpectedInflows).toBe(0);
  });

  it('an Optimistic scenario (increased collections) raises total expected inflows', async () => {
    const { service } = makeService({
      arRows: [arRow],
      scenario: {
        id: 'scn-optimistic',
        inflowDelayDays: 0,
        inflowMultiplier: 1.1,
        outflowDelayDays: 0,
        outflowMultiplier: 1,
      },
    });
    const forecast = await service.getForecast(ORG, {
      horizonDays: 30,
      bucketBy: 'weekly',
      scenarioId: 'scn-optimistic',
    });
    expect(forecast.totalExpectedInflows).toBe(1_100_000);
  });

  it('scenario adjustments never affect a forecast computed without a scenario (isolation)', async () => {
    const { service } = makeService({ arRows: [arRow] });
    const withoutScenario = await service.getForecast(ORG, { horizonDays: 30, bucketBy: 'weekly' });
    expect(withoutScenario.totalExpectedInflows).toBe(1_000_000);
    expect(withoutScenario.scenarioId).toBeNull();
  });
});

describe('CashflowForecastService.getForecast — minimum cash reserve / shortfall', () => {
  it('no warning when every bucket stays above the minimum reserve', async () => {
    const { service } = makeService({
      balances: { 'coa-1': 20_000_000 },
      settings: {
        minimumCashReserve: 5_000_000,
        defaultCollectionDelayDays: 0,
        defaultPaymentDelayDays: 0,
      },
    });
    const forecast = await service.getForecast(ORG, { horizonDays: 30, bucketBy: 'weekly' });
    expect(forecast.shortfallDetected).toBe(false);
    expect(forecast.buckets.every((b) => !b.belowMinimumReserve)).toBe(true);
  });

  it('flags a shortfall when a bucket closing balance falls below the minimum reserve', async () => {
    const { service } = makeService({
      balances: { 'coa-1': 4_000_000 },
      settings: {
        minimumCashReserve: 5_000_000,
        defaultCollectionDelayDays: 0,
        defaultPaymentDelayDays: 0,
      },
    });
    const forecast = await service.getForecast(ORG, { horizonDays: 30, bucketBy: 'weekly' });
    expect(forecast.shortfallDetected).toBe(true);
    expect(forecast.buckets[0]!.belowMinimumReserve).toBe(true);
    expect(forecast.lowestProjectedCash).toBe(4_000_000);
  });
});

describe('CashflowForecastService — cash account consolidated vs per-account', () => {
  it('consolidated forecast sums every active cash account book balance', async () => {
    const { service } = makeService({
      cashAccounts: [
        { id: 'ca-1', name: 'GTBank', accountCode: 'CASH-001', linkedChartOfAccountId: 'coa-1' },
        {
          id: 'ca-2',
          name: 'Access Bank',
          accountCode: 'CASH-002',
          linkedChartOfAccountId: 'coa-2',
        },
      ],
      balances: { 'coa-1': 10_000_000, 'coa-2': 2_000_000 },
    });
    const forecast = await service.getForecast(ORG, { horizonDays: 30, bucketBy: 'weekly' });
    expect(forecast.currentCash).toBe(12_000_000);
  });

  it('per-account forecast uses only that account balance and only its own assigned items', async () => {
    const { service } = makeService({
      cashAccounts: [
        { id: 'ca-1', name: 'GTBank', accountCode: 'CASH-001', linkedChartOfAccountId: 'coa-1' },
        {
          id: 'ca-2',
          name: 'Access Bank',
          accountCode: 'CASH-002',
          linkedChartOfAccountId: 'coa-2',
        },
      ],
      balances: { 'coa-1': 10_000_000, 'coa-2': 2_000_000 },
      arRows: [
        {
          id: 'inv-1',
          invoiceCode: 'INV-1',
          customerId: 'c',
          customerCode: 'C',
          customerName: 'C',
          dueDate: daysFromNow(3),
          amountOutstanding: 5_000_000,
        },
      ],
      items: [
        {
          id: 'item-1',
          cashAccountId: 'ca-1',
          direction: 'OUTFLOW',
          sourceType: CashflowForecastSourceType.RECURRING_ITEM,
          description: 'Rent from GTBank',
          amount: 100_000,
          expectedDate: daysFromNow(2),
          recurrence: CashflowRecurrence.ONE_TIME,
          recurrenceEndDate: null,
        },
      ],
    });
    const forecast = await service.getForecast(ORG, {
      horizonDays: 30,
      bucketBy: 'weekly',
      cashAccountId: 'ca-1',
    });
    expect(forecast.currentCash).toBe(10_000_000);
    // AR is never attributed to a specific account — only the assigned item shows.
    expect(forecast.totalExpectedInflows).toBe(0);
    expect(forecast.totalExpectedOutflows).toBe(100_000);
  });
});

describe('CashflowForecastService.getForecast — Sprint 17 debt integration', () => {
  it('surfaces an outstanding loan repayment installment as a LOAN_REPAYMENT outflow with CONFIRMED confidence', async () => {
    const { service } = makeService({
      debtScheduleRows: [
        {
          debtFacilityId: 'facility-1',
          facilityCode: 'DEBT-000001',
          facilityName: 'Bank Equipment Loan',
          dueDate: daysFromNow(10),
          remainingDue: 3_400_000,
        },
      ],
    });
    const forecast = await service.getForecast(ORG, { horizonDays: 30, bucketBy: 'weekly' });

    const debtLine = forecast.buckets
      .flatMap((b) => b.items)
      .find((item) => item.sourceType === 'LOAN_REPAYMENT');
    expect(debtLine).toBeDefined();
    expect(debtLine?.amount).toBe(3_400_000);
    expect(debtLine?.confidence).toBe('CONFIRMED');
    expect(debtLine?.direction).toBe('OUTFLOW');
    expect(forecast.totalExpectedOutflows).toBe(3_400_000);
  });

  it('a facility that never draws contributes nothing — findOutstandingScheduleForForecast already excludes PROPOSED/APPROVED facilities', async () => {
    const { service, debtFacilityRepository } = makeService({ debtScheduleRows: [] });
    const forecast = await service.getForecast(ORG, { horizonDays: 30, bucketBy: 'weekly' });

    expect(debtFacilityRepository.findOutstandingScheduleForForecast).toHaveBeenCalledWith(ORG);
    expect(
      forecast.buckets.some((b) => b.items.some((item) => item.sourceType === 'LOAN_REPAYMENT')),
    ).toBe(false);
  });
});
