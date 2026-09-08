import { MaintenanceCostRepository } from './maintenance-cost.repository';
import { PrismaService } from '../prisma/prisma.service';

const ORG = 'org-1';

function makeRepository() {
  const costs = new Map<string, Record<string, unknown>>();
  let seq = 0;

  const tx = {
    maintenanceCost: {
      findUnique: jest.fn(
        async ({
          where,
        }: {
          where: {
            organisationId_idempotencyKey?: { organisationId: string; idempotencyKey: string };
          };
        }) => {
          const lookup = where.organisationId_idempotencyKey;
          if (!lookup) return null;
          for (const row of costs.values()) {
            if (
              row.organisationId === lookup.organisationId &&
              row.idempotencyKey === lookup.idempotencyKey
            ) {
              return row;
            }
          }
          return null;
        },
      ),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        seq += 1;
        const row = { id: `cost-${seq}`, ...data };
        costs.set(row.id, row);
        return row;
      }),
    },
  };

  const prisma = {
    $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb(tx)),
  } as unknown as PrismaService;

  return { repository: new MaintenanceCostRepository(prisma), costs };
}

describe('MaintenanceCostRepository.record', () => {
  it('always server-computes totalCost as quantity × unitCost, ignoring any pre-existing value', async () => {
    const { repository } = makeRepository();
    const result = await repository.record({
      organisationId: ORG,
      workOrderId: 'wo-1',
      category: 'PARTS',
      quantity: 3,
      unitCost: 1500.5,
      currency: 'NGN',
      recordedById: 'user-1',
    });
    expect(result.cost.totalCost).toBe(4501.5);
  });

  it('rounds totalCost to 2 decimal places', async () => {
    const { repository } = makeRepository();
    const result = await repository.record({
      organisationId: ORG,
      workOrderId: 'wo-1',
      category: 'LABOUR',
      quantity: 3,
      unitCost: 333.333,
      currency: 'NGN',
      recordedById: 'user-1',
    });
    expect(result.cost.totalCost).toBe(1000);
  });

  it('idempotent replay: a duplicate idempotencyKey does not create a second cost row', async () => {
    const { repository, costs } = makeRepository();
    await repository.record({
      organisationId: ORG,
      workOrderId: 'wo-1',
      category: 'SERVICE',
      quantity: 1,
      unitCost: 50000,
      currency: 'NGN',
      recordedById: 'user-1',
      idempotencyKey: 'cost-dup',
    });
    const second = await repository.record({
      organisationId: ORG,
      workOrderId: 'wo-1',
      category: 'SERVICE',
      quantity: 1,
      unitCost: 50000,
      currency: 'NGN',
      recordedById: 'user-1',
      idempotencyKey: 'cost-dup',
    });
    expect(second.wasCreated).toBe(false);
    expect(costs.size).toBe(1);
  });
});
