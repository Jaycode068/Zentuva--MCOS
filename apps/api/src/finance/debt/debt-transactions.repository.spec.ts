import { DebtFacilityStatus, DebtScheduleStatus } from '@prisma/client';

import { NoOpenPeriodError } from '../accounting/journal-posting';
import { PrismaService } from '../../prisma/prisma.service';
import { DebtDrawdownRepository } from './debt-drawdown.repository';
import { DebtRepaymentRepository } from './debt-repayment.repository';

/**
 * A deliberate exception to this codebase's "no repository-level unit tests
 * for atomic transactions" convention — same justification as
 * `cash-account.repository.spec.ts`. Exercises `DebtDrawdownRepository`/
 * `DebtRepaymentRepository`'s real transaction logic (accounting posting,
 * schedule application, auto status transitions, idempotency, over-draw/
 * over-repayment rejection, closed-period rollback) against a fake `tx`
 * supporting exactly the Prisma calls `postSystemJournalEntry` and these
 * repositories themselves make.
 */
function makeFakeTx(
  params: {
    facility?: Record<string, unknown>;
    schedule?: Record<string, unknown>[];
    periodOpen?: boolean;
    seedDrawdownAmount?: number;
  } = {},
) {
  const facility: Record<string, unknown> = params.facility ?? {
    id: 'facility-1',
    organisationId: 'org-1',
    facilityCode: 'DEBT-000001',
    name: 'Bank Equipment Loan',
    status: DebtFacilityStatus.APPROVED,
    principalAmount: 60_000_000,
    liabilityAccountId: 'coa-liability',
    interestExpenseAccountId: 'coa-interest',
  };
  const facilities = new Map<string, Record<string, unknown>>([[facility.id as string, facility]]);
  const cashAccounts = new Map<string, Record<string, unknown>>([
    ['cash-1', { id: 'cash-1', organisationId: 'org-1', linkedChartOfAccountId: 'coa-cash' }],
  ]);
  const chartOfAccounts = new Map<string, Record<string, unknown>>([
    [
      'coa-liability',
      { id: 'coa-liability', organisationId: 'org-1', type: 'LIABILITY', isSystemAccount: false },
    ],
    [
      'coa-interest',
      { id: 'coa-interest', organisationId: 'org-1', type: 'EXPENSE', isSystemAccount: false },
    ],
    [
      'coa-cash',
      { id: 'coa-cash', organisationId: 'org-1', type: 'ASSET', isSystemAccount: false },
    ],
    [
      'coa-fee',
      { id: 'coa-fee', organisationId: 'org-1', type: 'EXPENSE', isSystemAccount: false },
    ],
  ]);
  const drawdowns = new Map<string, Record<string, unknown>>(
    params.seedDrawdownAmount
      ? [
          [
            'seed-drawdown-1',
            {
              id: 'seed-drawdown-1',
              organisationId: 'org-1',
              debtFacilityId: facility.id,
              amount: params.seedDrawdownAmount,
            },
          ],
        ]
      : [],
  );
  const repayments = new Map<string, Record<string, unknown>>();
  const schedule = new Map<string, Record<string, unknown>>(
    (params.schedule ?? defaultSchedule(facility.id as string)).map((row, index) => [
      `sched-${index + 1}`,
      { id: `sched-${index + 1}`, ...row },
    ]),
  );
  const journalEntries = new Map<string, Record<string, unknown>>();
  let drawdownSeq = 0;
  let repaymentSeq = 0;
  let journalSeq = 0;

  const tx = {
    debtFacility: {
      findFirst: jest.fn(async ({ where }: { where: { id: string; organisationId: string } }) => {
        const row = facilities.get(where.id);
        if (!row || row.organisationId !== where.organisationId) return null;
        return row;
      }),
      update: jest.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = facilities.get(where.id)!;
          Object.assign(row, data);
          return row;
        },
      ),
      findUniqueOrThrow: jest.fn(async ({ where }: { where: { id: string } }) =>
        facilities.get(where.id)!,
      ),
    },
    cashAccount: {
      findFirst: jest.fn(async ({ where }: { where: { id: string; organisationId: string } }) => {
        const row = cashAccounts.get(where.id);
        if (!row || row.organisationId !== where.organisationId) return null;
        return row;
      }),
    },
    chartOfAccount: {
      findFirst: jest.fn(
        async ({
          where,
        }: {
          where: { id?: string; organisationId: string; systemKey?: string };
        }) => {
          if (where.id) {
            const row = chartOfAccounts.get(where.id);
            if (!row || row.organisationId !== where.organisationId) return null;
            return row;
          }
          return null;
        },
      ),
    },
    debtDrawdown: {
      findUnique: jest.fn(
        async ({
          where,
        }: {
          where: {
            organisationId_idempotencyKey?: { organisationId: string; idempotencyKey: string };
          };
        }) => {
          const key = where.organisationId_idempotencyKey;
          if (!key) return null;
          for (const row of drawdowns.values()) {
            if (
              row.organisationId === key.organisationId &&
              row.idempotencyKey === key.idempotencyKey
            )
              return row;
          }
          return null;
        },
      ),
      aggregate: jest.fn(async ({ where }: { where: { debtFacilityId: string } }) => {
        const sum = [...drawdowns.values()]
          .filter((row) => row.debtFacilityId === where.debtFacilityId)
          .reduce((total, row) => total + (row.amount as number), 0);
        return { _sum: { amount: drawdowns.size ? sum : null } };
      }),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        drawdownSeq += 1;
        const id = `drawdown-${drawdownSeq}`;
        const row = { id, ...data };
        drawdowns.set(id, row);
        return row;
      }),
    },
    debtRepayment: {
      findUnique: jest.fn(
        async ({
          where,
        }: {
          where: {
            organisationId_idempotencyKey?: { organisationId: string; idempotencyKey: string };
          };
        }) => {
          const key = where.organisationId_idempotencyKey;
          if (!key) return null;
          for (const row of repayments.values()) {
            if (
              row.organisationId === key.organisationId &&
              row.idempotencyKey === key.idempotencyKey
            )
              return row;
          }
          return null;
        },
      ),
      aggregate: jest.fn(async ({ where }: { where: { debtFacilityId: string } }) => {
        const rows = [...repayments.values()].filter(
          (row) => row.debtFacilityId === where.debtFacilityId,
        );
        return {
          _sum: {
            principalAmount: rows.length
              ? rows.reduce((s, r) => s + (r.principalAmount as number), 0)
              : null,
            interestAmount: rows.length
              ? rows.reduce((s, r) => s + (r.interestAmount as number), 0)
              : null,
          },
        };
      }),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        repaymentSeq += 1;
        const id = `repayment-${repaymentSeq}`;
        const row = { id, ...data };
        repayments.set(id, row);
        return row;
      }),
    },
    debtRepaymentSchedule: {
      findMany: jest.fn(
        async ({
          where,
        }: {
          where: {
            debtFacilityId?: string;
            dueDate?: { lte: Date };
            status?: { not: DebtScheduleStatus };
          };
        }) => {
          let rows = [...schedule.values()];
          if (where.debtFacilityId)
            rows = rows.filter((row) => row.debtFacilityId === where.debtFacilityId);
          if (where.dueDate)
            rows = rows.filter((row) => (row.dueDate as Date) <= where.dueDate!.lte);
          if (where.status) rows = rows.filter((row) => row.status !== where.status!.not);
          return rows.sort(
            (a, b) => (a.installmentNumber as number) - (b.installmentNumber as number),
          );
        },
      ),
      update: jest.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = schedule.get(where.id)!;
          Object.assign(row, data);
          return row;
        },
      ),
    },
    journalEntry: {
      findUnique: jest.fn(async () => null),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        journalSeq += 1;
        const id = `journal-${journalSeq}`;
        const entry = { id, ...data };
        journalEntries.set(id, entry);
        return entry;
      }),
    },
    accountingPeriod: {
      findFirst: jest.fn(async () =>
        params.periodOpen === false ? null : { id: 'period-1', status: 'OPEN' },
      ),
    },
  };

  const prisma = {
    $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb(tx)),
  } as unknown as PrismaService;

  return { prisma, tx, facility, facilities, drawdowns, repayments, schedule, journalEntries };
}

function defaultSchedule(debtFacilityId: string) {
  return [
    {
      debtFacilityId,
      installmentNumber: 1,
      dueDate: new Date(2026, 0, 1),
      openingPrincipal: 60_000_000,
      principalDue: 2_400_000,
      interestDue: 1_000_000,
      totalDue: 3_400_000,
      closingPrincipal: 57_600_000,
      amountPaid: 0,
      status: DebtScheduleStatus.SCHEDULED,
    },
    {
      debtFacilityId,
      installmentNumber: 2,
      dueDate: new Date(2026, 1, 1),
      openingPrincipal: 57_600_000,
      principalDue: 2_450_000,
      interestDue: 950_000,
      totalDue: 3_400_000,
      closingPrincipal: 55_150_000,
      amountPaid: 0,
      status: DebtScheduleStatus.SCHEDULED,
    },
  ];
}

const ORG = 'org-1';

describe('DebtDrawdownRepository.create', () => {
  it('posts DR cash / CR liability, and activates the facility on the first drawdown', async () => {
    const { prisma, journalEntries, facility } = makeFakeTx();
    const repository = new DebtDrawdownRepository(prisma);

    const result = await repository.create({
      organisationId: ORG,
      debtFacilityId: 'facility-1',
      cashAccountId: 'cash-1',
      amount: 60_000_000,
      drawdownDate: new Date(2025, 11, 1),
      createdById: 'user-1',
    });

    expect(result.wasCreated).toBe(true);
    expect(result.facilityActivated).toBe(true);
    expect(facility.status).toBe(DebtFacilityStatus.ACTIVE);
    const journal = [...journalEntries.values()][0] as {
      lines: { create: { accountId: string; debit: number; credit: number }[] };
    };
    const lines = journal.lines.create;
    expect(lines).toContainEqual(
      expect.objectContaining({ accountId: 'coa-cash', debit: 60_000_000, credit: 0 }),
    );
    expect(lines).toContainEqual(
      expect.objectContaining({ accountId: 'coa-liability', debit: 0, credit: 60_000_000 }),
    );
  });

  it('rejects a drawdown that would exceed the facility principal', async () => {
    const { prisma } = makeFakeTx();
    const repository = new DebtDrawdownRepository(prisma);

    await expect(
      repository.create({
        organisationId: ORG,
        debtFacilityId: 'facility-1',
        cashAccountId: 'cash-1',
        amount: 70_000_000,
        drawdownDate: new Date(2025, 11, 1),
        createdById: 'user-1',
      }),
    ).rejects.toThrow(/exceed/);
  });

  it('is idempotent — a replayed idempotencyKey returns the original result, no duplicate row', async () => {
    const { prisma, drawdowns } = makeFakeTx();
    const repository = new DebtDrawdownRepository(prisma);
    const input = {
      organisationId: ORG,
      debtFacilityId: 'facility-1',
      cashAccountId: 'cash-1',
      amount: 60_000_000,
      drawdownDate: new Date(2025, 11, 1),
      idempotencyKey: 'draw-key-1',
      createdById: 'user-1',
    };

    const first = await repository.create(input);
    const second = await repository.create(input);

    expect(first.wasCreated).toBe(true);
    expect(second.wasCreated).toBe(false);
    expect(second.debtDrawdown.id).toBe(first.debtDrawdown.id);
    expect(drawdowns.size).toBe(1);
  });

  it('rejects with NoOpenPeriodError when the accounting period is closed — the same guard postSystemJournalEntry enforces for every other domain, so the real Postgres transaction rolls back atomically in production (this fake, in-memory tx cannot itself simulate DB-level rollback, unlike a real one)', async () => {
    const { prisma } = makeFakeTx({ periodOpen: false });
    const repository = new DebtDrawdownRepository(prisma);

    await expect(
      repository.create({
        organisationId: ORG,
        debtFacilityId: 'facility-1',
        cashAccountId: 'cash-1',
        amount: 60_000_000,
        drawdownDate: new Date(2025, 11, 1),
        createdById: 'user-1',
      }),
    ).rejects.toThrow(NoOpenPeriodError);
  });
});

describe('DebtRepaymentRepository.create', () => {
  function activeFixture() {
    return makeFakeTx({
      facility: {
        id: 'facility-1',
        organisationId: ORG,
        facilityCode: 'DEBT-000001',
        name: 'Bank Equipment Loan',
        status: DebtFacilityStatus.ACTIVE,
        principalAmount: 60_000_000,
        liabilityAccountId: 'coa-liability',
        interestExpenseAccountId: 'coa-interest',
      },
      // Already drawn in full — a repayment now has real outstanding
      // principal/interest to apply against.
      seedDrawdownAmount: 60_000_000,
    });
  }

  it('posts a combined principal+interest repayment as one balanced multi-line entry', async () => {
    const { prisma, journalEntries } = activeFixture();
    const repository = new DebtRepaymentRepository(prisma);

    const result = await repository.create({
      organisationId: ORG,
      debtFacilityId: 'facility-1',
      cashAccountId: 'cash-1',
      paymentDate: new Date(2026, 0, 1),
      principalAmount: 2_400_000,
      interestAmount: 1_000_000,
      feeAmount: 0,
      createdById: 'user-1',
    });

    expect(result.wasCreated).toBe(true);
    const journal = [...journalEntries.values()][0] as {
      lines: { create: { accountId: string; debit: number; credit: number }[] };
    };
    const lines = journal.lines.create;
    expect(lines).toContainEqual(
      expect.objectContaining({ accountId: 'coa-liability', debit: 2_400_000 }),
    );
    expect(lines).toContainEqual(
      expect.objectContaining({ accountId: 'coa-interest', debit: 1_000_000 }),
    );
    expect(lines).toContainEqual(
      expect.objectContaining({ accountId: 'coa-cash', credit: 3_400_000 }),
    );
  });

  it('applies the payment to the oldest unpaid installment first and marks it PAID', async () => {
    const { prisma, schedule } = activeFixture();
    const repository = new DebtRepaymentRepository(prisma);

    await repository.create({
      organisationId: ORG,
      debtFacilityId: 'facility-1',
      cashAccountId: 'cash-1',
      paymentDate: new Date(2026, 0, 1),
      principalAmount: 2_400_000,
      interestAmount: 1_000_000,
      feeAmount: 0,
      createdById: 'user-1',
    });

    const first = schedule.get('sched-1')!;
    const second = schedule.get('sched-2')!;
    expect(first.status).toBe(DebtScheduleStatus.PAID);
    expect(second.status).toBe(DebtScheduleStatus.SCHEDULED);
  });

  it('rejects a principal repayment exceeding the live outstanding principal (§35)', async () => {
    const { prisma } = makeFakeTx({
      facility: {
        id: 'facility-1',
        organisationId: ORG,
        facilityCode: 'DEBT-000001',
        name: 'Bank Equipment Loan',
        status: DebtFacilityStatus.ACTIVE,
        principalAmount: 60_000_000,
        liabilityAccountId: 'coa-liability',
        interestExpenseAccountId: 'coa-interest',
      },
    });
    // No drawdown recorded — outstandingPrincipal (totalDrawn − repaid) is 0.
    const repository = new DebtRepaymentRepository(prisma);

    await expect(
      repository.create({
        organisationId: ORG,
        debtFacilityId: 'facility-1',
        cashAccountId: 'cash-1',
        paymentDate: new Date(2026, 0, 1),
        principalAmount: 1_000_000,
        interestAmount: 0,
        feeAmount: 0,
        createdById: 'user-1',
      }),
    ).rejects.toThrow(/exceeds outstanding principal/);
  });

  it('auto-transitions the facility to PAID_OFF once every drawn principal is repaid (early payoff, §36)', async () => {
    const { prisma, facility } = makeFakeTx({
      facility: {
        id: 'facility-1',
        organisationId: ORG,
        facilityCode: 'DEBT-000001',
        name: 'Bank Equipment Loan',
        status: DebtFacilityStatus.ACTIVE,
        principalAmount: 3_400_000,
        liabilityAccountId: 'coa-liability',
        interestExpenseAccountId: 'coa-interest',
      },
      schedule: [
        {
          debtFacilityId: 'facility-1',
          installmentNumber: 1,
          dueDate: new Date(2026, 0, 1),
          openingPrincipal: 3_400_000,
          principalDue: 3_400_000,
          interestDue: 0,
          totalDue: 3_400_000,
          closingPrincipal: 0,
          amountPaid: 0,
          status: DebtScheduleStatus.SCHEDULED,
        },
      ],
    });
    const drawdownRepo = new DebtDrawdownRepository(prisma);
    await drawdownRepo.create({
      organisationId: ORG,
      debtFacilityId: 'facility-1',
      cashAccountId: 'cash-1',
      amount: 3_400_000,
      drawdownDate: new Date(2025, 11, 1),
      createdById: 'user-1',
    });

    const repository = new DebtRepaymentRepository(prisma);
    const result = await repository.create({
      organisationId: ORG,
      debtFacilityId: 'facility-1',
      cashAccountId: 'cash-1',
      paymentDate: new Date(2026, 0, 1),
      principalAmount: 3_400_000,
      interestAmount: 0,
      feeAmount: 0,
      createdById: 'user-1',
    });

    expect(result.facilityStatus).toBe(DebtFacilityStatus.PAID_OFF);
    expect(facility.status).toBe(DebtFacilityStatus.PAID_OFF);
  });

  it('is idempotent — a replayed idempotencyKey returns the original result, no duplicate row', async () => {
    const { prisma, repayments } = activeFixture();
    const repository = new DebtRepaymentRepository(prisma);
    const input = {
      organisationId: ORG,
      debtFacilityId: 'facility-1',
      cashAccountId: 'cash-1',
      paymentDate: new Date(2026, 0, 1),
      principalAmount: 2_400_000,
      interestAmount: 1_000_000,
      feeAmount: 0,
      idempotencyKey: 'repay-key-1',
      createdById: 'user-1',
    };

    const first = await repository.create(input);
    const second = await repository.create(input);

    expect(first.wasCreated).toBe(true);
    expect(second.wasCreated).toBe(false);
    expect(second.debtRepayment.id).toBe(first.debtRepayment.id);
    expect(repayments.size).toBe(1);
  });
});
