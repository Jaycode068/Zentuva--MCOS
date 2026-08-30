import { CashflowDirection, CashflowForecastSourceType, CashflowRecurrence } from '@prisma/client';

import { CashflowItemRepository } from './cashflow-item.repository';
import { PrismaService } from '../../prisma/prisma.service';

function makeFakeTx() {
  const items = new Map<string, Record<string, unknown>>();
  let sequence = 0;

  const tx = {
    cashflowForecastItem: {
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
          for (const item of items.values()) {
            if (
              item.organisationId === key.organisationId &&
              item.idempotencyKey === key.idempotencyKey
            ) {
              return item;
            }
          }
          return null;
        },
      ),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        sequence += 1;
        const id = `item-${sequence}`;
        const item = { id, ...data };
        items.set(id, item);
        return item;
      }),
    },
  };

  return { tx, items };
}

function makeRepository() {
  const fake = makeFakeTx();
  const prisma = {
    $transaction: jest.fn(async (callback: (tx: unknown) => unknown) => callback(fake.tx)),
    cashflowForecastItem: {
      findFirst: jest.fn(async ({ where }: { where: { id: string; organisationId?: string } }) => {
        const item = fake.items.get(where.id);
        if (!item) return null;
        if (where.organisationId && item.organisationId !== where.organisationId) return null;
        return item;
      }),
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string; organisationId: string };
          data: Record<string, unknown>;
        }) => {
          const item = fake.items.get(where.id);
          if (!item || item.organisationId !== where.organisationId) return { count: 0 };
          Object.assign(item, data);
          return { count: 1 };
        },
      ),
      findUniqueOrThrow: jest.fn(async ({ where }: { where: { id: string } }) =>
        fake.items.get(where.id)!,
      ),
    },
  } as unknown as PrismaService;
  return { repository: new CashflowItemRepository(prisma), ...fake };
}

const ORG = 'org-1';

describe('CashflowItemRepository.create', () => {
  it('derives sourceType MANUAL_FORECAST for a ONE_TIME item', async () => {
    const { repository } = makeRepository();
    const result = await repository.create({
      organisationId: ORG,
      direction: CashflowDirection.INFLOW,
      description: 'Expected additional customer collection',
      amount: 4_000_000,
      currency: 'NGN',
      expectedDate: new Date(),
      recurrence: CashflowRecurrence.ONE_TIME,
      createdById: 'user-1',
    });
    expect(result.wasCreated).toBe(true);
    expect(result.cashflowForecastItem.sourceType).toBe(CashflowForecastSourceType.MANUAL_FORECAST);
  });

  it('derives sourceType RECURRING_ITEM for a MONTHLY item', async () => {
    const { repository } = makeRepository();
    const result = await repository.create({
      organisationId: ORG,
      direction: CashflowDirection.OUTFLOW,
      description: 'Factory Rent',
      amount: 1_500_000,
      currency: 'NGN',
      expectedDate: new Date(),
      recurrence: CashflowRecurrence.MONTHLY,
      createdById: 'user-1',
    });
    expect(result.cashflowForecastItem.sourceType).toBe(CashflowForecastSourceType.RECURRING_ITEM);
  });

  it('is idempotent — a replayed idempotencyKey returns the original result', async () => {
    const { repository, items } = makeRepository();
    const input = {
      organisationId: ORG,
      direction: CashflowDirection.OUTFLOW,
      description: 'Factory Rent',
      amount: 1_500_000,
      currency: 'NGN',
      expectedDate: new Date(),
      recurrence: CashflowRecurrence.MONTHLY,
      idempotencyKey: 'key-1',
      createdById: 'user-1',
    };
    const first = await repository.create(input);
    const second = await repository.create(input);
    expect(first.wasCreated).toBe(true);
    expect(second.wasCreated).toBe(false);
    expect(second.cashflowForecastItem.id).toBe(first.cashflowForecastItem.id);
    expect(items.size).toBe(1);
  });
});

describe('CashflowItemRepository.deactivate/activate', () => {
  it('flips status and is tenant-scoped', async () => {
    const { repository } = makeRepository();
    const { cashflowForecastItem } = await repository.create({
      organisationId: ORG,
      direction: CashflowDirection.OUTFLOW,
      description: 'Rent',
      amount: 100,
      currency: 'NGN',
      expectedDate: new Date(),
      recurrence: CashflowRecurrence.ONE_TIME,
      createdById: 'user-1',
    });

    const deactivated = await repository.deactivate(ORG, cashflowForecastItem.id, 'user-1');
    expect(deactivated?.status).toBe('INACTIVE');

    const crossTenant = await repository.deactivate('org-2', cashflowForecastItem.id, 'user-1');
    expect(crossTenant).toBeNull();

    const activated = await repository.activate(ORG, cashflowForecastItem.id, 'user-1');
    expect(activated?.status).toBe('ACTIVE');
  });
});
