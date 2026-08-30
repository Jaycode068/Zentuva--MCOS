import { BudgetLineType } from '@prisma/client';

import { BudgetLineRepository } from './budget-line.repository';
import { PrismaService } from '../../prisma/prisma.service';

function makeRepository() {
  const lines = new Map<string, Record<string, unknown>>();
  let sequence = 0;

  const model = {
    findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
      for (const line of lines.values()) {
        if (Object.entries(where).every(([key, value]) => line[key] === value)) return line;
      }
      return null;
    }),
    findMany: jest.fn(async ({ where }: { where: { budgetId: string } }) =>
      [...lines.values()].filter((line) => line.budgetId === where.budgetId),
    ),
    create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
      sequence += 1;
      const id = `line-${sequence}`;
      // Mirrors real Postgres: an omitted/undefined nullable column is stored
      // as NULL, which a later `WHERE costCentreId IS NULL` correctly matches.
      const line = {
        id,
        ...data,
        chartOfAccountId: data.chartOfAccountId ?? null,
        costCentreId: data.costCentreId ?? null,
      };
      lines.set(id, line);
      return line;
    }),
    update: jest.fn(
      async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const line = lines.get(where.id)!;
        Object.assign(line, data);
        return line;
      },
    ),
    updateMany: jest.fn(
      async ({
        where,
        data,
      }: {
        where: { id: string; budgetId: string };
        data: Record<string, unknown>;
      }) => {
        const line = lines.get(where.id);
        if (!line || line.budgetId !== where.budgetId) return { count: 0 };
        Object.assign(line, data);
        return { count: 1 };
      },
    ),
    findUniqueOrThrow: jest.fn(async ({ where }: { where: { id: string } }) =>
      lines.get(where.id)!,
    ),
  };

  const prisma = {
    $transaction: jest.fn(async (callback: (tx: unknown) => unknown) => callback(prisma)),
    budgetLine: model,
  } as unknown as PrismaService;

  return { repository: new BudgetLineRepository(prisma), lines };
}

const BUDGET = 'budget-1';

describe('BudgetLineRepository.upsert — REVENUE/OPERATING_EXPENSE (chartOfAccountId set)', () => {
  it('creates once, then a second call for the same natural key updates the amount instead of duplicating', async () => {
    const { repository, lines } = makeRepository();
    const base = {
      budgetId: BUDGET,
      chartOfAccountId: 'account-4100',
      lineType: BudgetLineType.REVENUE,
      periodMonth: new Date(2026, 0, 1),
      actorUserId: 'user-1',
    };

    const first = await repository.upsert({ ...base, amount: 30_000_000 });
    expect(first.wasCreated).toBe(true);

    const second = await repository.upsert({ ...base, amount: 35_000_000 });
    expect(second.wasCreated).toBe(false);
    expect(second.budgetLine.id).toBe(first.budgetLine.id);
    expect(second.budgetLine.amount).toBe(35_000_000);
    expect(lines.size).toBe(1);
  });

  it('a different month for the same account creates an independent line', async () => {
    const { repository, lines } = makeRepository();
    await repository.upsert({
      budgetId: BUDGET,
      chartOfAccountId: 'account-4100',
      lineType: BudgetLineType.REVENUE,
      periodMonth: new Date(2026, 0, 1),
      amount: 30_000_000,
      actorUserId: 'user-1',
    });
    await repository.upsert({
      budgetId: BUDGET,
      chartOfAccountId: 'account-4100',
      lineType: BudgetLineType.REVENUE,
      periodMonth: new Date(2026, 1, 1),
      amount: 32_000_000,
      actorUserId: 'user-1',
    });
    expect(lines.size).toBe(2);
  });
});

describe('BudgetLineRepository.upsert — CAPEX without an account', () => {
  it('every call creates a new, independent, discrete line item — never merged', async () => {
    const { repository, lines } = makeRepository();
    const base = {
      budgetId: BUDGET,
      lineType: BudgetLineType.CAPEX,
      periodMonth: new Date(2026, 5, 1),
      actorUserId: 'user-1',
    };

    const first = await repository.upsert({
      ...base,
      amount: 8_000_000,
      description: 'Packaging Machine',
    });
    const second = await repository.upsert({
      ...base,
      amount: 3_000_000,
      description: 'Delivery Van',
    });

    expect(first.wasCreated).toBe(true);
    expect(second.wasCreated).toBe(true);
    expect(first.budgetLine.id).not.toBe(second.budgetLine.id);
    expect(lines.size).toBe(2);
  });
});
