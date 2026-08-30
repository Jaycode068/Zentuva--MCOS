import { BudgetStatus } from '@prisma/client';

import { BudgetRepository } from './budget.repository';
import { PrismaService } from '../../prisma/prisma.service';

/** A single in-memory store shared by every mocked Prisma method — including
 *  inside `$transaction`, which simply invokes the callback with the same
 *  object — since these tests exercise data flow, not literal rollback. */
function makeRepository() {
  const budgets = new Map<string, Record<string, unknown>>();
  const budgetLines = new Map<string, Record<string, unknown>>();
  let sequence = 0;

  const model = {
    findFirst: jest.fn(
      async ({
        where,
        include,
      }: {
        where: Record<string, unknown>;
        include?: { lines?: boolean };
      }) => {
        for (const budget of budgets.values()) {
          if (matches(budget, where)) {
            if (include?.lines) {
              return {
                ...budget,
                lines: [...budgetLines.values()].filter((line) => line.budgetId === budget.id),
              };
            }
            return budget;
          }
        }
        return null;
      },
    ),
    findMany: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
      [...budgets.values()].filter((budget) => matches(budget, where)),
    ),
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
        for (const budget of budgets.values()) {
          if (
            budget.organisationId === key.organisationId &&
            budget.idempotencyKey === key.idempotencyKey
          ) {
            return budget;
          }
        }
        return null;
      },
    ),
    findUniqueOrThrow: jest.fn(async ({ where }: { where: { id: string } }) =>
      budgets.get(where.id)!,
    ),
    create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
      sequence += 1;
      const id = `budget-${sequence}`;
      const budget = { id, version: 1, status: BudgetStatus.DRAFT, ...data };
      budgets.set(id, budget);
      return budget;
    }),
    update: jest.fn(
      async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const budget = budgets.get(where.id)!;
        Object.assign(budget, data);
        return budget;
      },
    ),
    updateMany: jest.fn(
      async ({
        where,
        data,
      }: {
        where: { id: string; organisationId: string };
        data: Record<string, unknown>;
      }) => {
        const budget = budgets.get(where.id);
        if (!budget || budget.organisationId !== where.organisationId) return { count: 0 };
        Object.assign(budget, data);
        return { count: 1 };
      },
    ),
  };

  const lineModel = {
    createMany: jest.fn(async ({ data }: { data: Record<string, unknown>[] }) => {
      for (const line of data) {
        sequence += 1;
        budgetLines.set(`line-${sequence}`, { id: `line-${sequence}`, ...line });
      }
      return { count: data.length };
    }),
  };

  function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
    return Object.entries(where).every(([key, value]) => {
      if (key === 'id' && value && typeof value === 'object' && 'not' in (value as object)) {
        return row.id !== (value as { not: string }).not;
      }
      return row[key] === value;
    });
  }

  const prisma = {
    $transaction: jest.fn(async (callback: (tx: unknown) => unknown) => callback(prisma)),
    budget: model,
    budgetLine: lineModel,
  } as unknown as PrismaService;

  return { repository: new BudgetRepository(prisma), budgets, budgetLines };
}

const ORG = 'org-1';

function budgetData(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    organisationId: ORG,
    budgetCode: 'BUD-2026-OPS',
    name: '2026 Operating Budget',
    fiscalYear: 2026,
    scenarioName: 'Base',
    startDate: new Date(2026, 0, 1),
    endDate: new Date(2026, 11, 31),
    currency: 'NGN',
    createdById: 'user-1',
    ...overrides,
  };
}

describe('BudgetRepository.create', () => {
  it('is idempotent — a replayed idempotencyKey returns the original result', async () => {
    const { repository, budgets } = makeRepository();
    const input = budgetData({ idempotencyKey: 'key-1' });
    const first = await repository.create(input as any);
    const second = await repository.create(input as any);
    expect(first.wasCreated).toBe(true);
    expect(second.wasCreated).toBe(false);
    expect(second.budget.id).toBe(first.budget.id);
    expect(budgets.size).toBe(1);
  });
});

describe('BudgetRepository.activate', () => {
  it('supersedes the previously ACTIVE row in the same (budgetCode, scenarioName) lineage', async () => {
    const { repository } = makeRepository();
    const { budget: v1 } = await repository.create(budgetData() as any);
    await repository.activate(ORG, v1.id);
    expect((await repository.findById(ORG, v1.id))?.status).toBe(BudgetStatus.ACTIVE);

    const { budget: v2 } = await repository.create(budgetData({ idempotencyKey: 'v2' }) as any);
    await repository.activate(ORG, v2.id);

    expect((await repository.findById(ORG, v1.id))?.status).toBe(BudgetStatus.SUPERSEDED);
    expect((await repository.findById(ORG, v2.id))?.status).toBe(BudgetStatus.ACTIVE);
  });
});

describe('BudgetRepository.revise', () => {
  it('creates the next version pointing back at the source and preserves the original', async () => {
    const { repository } = makeRepository();
    const { budget: original } = await repository.create(budgetData() as any);

    const revision = await repository.revise(ORG, original.id, 'user-2');

    expect(revision?.version).toBe(2);
    expect(revision?.revisesBudgetId).toBe(original.id);
    expect(revision?.status).toBe(BudgetStatus.DRAFT);
    const stillThere = await repository.findById(ORG, original.id);
    expect(stillThere?.status).toBe(BudgetStatus.DRAFT);
    expect(stillThere?.version).toBe(1);
  });
});

describe('BudgetRepository tenant isolation', () => {
  it('findById never returns a row belonging to a different organisation', async () => {
    const { repository } = makeRepository();
    const { budget } = await repository.create(budgetData() as any);
    expect(await repository.findById('org-2', budget.id)).toBeNull();
    expect(await repository.findById(ORG, budget.id)).not.toBeNull();
  });
});
