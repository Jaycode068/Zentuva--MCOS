import {
  InsufficientStockError,
  MaintenancePartUsageRepository,
  PartUsageNotFoundError,
  PartUsageStatusConflictError,
} from './maintenance-part-usage.repository';
import { PrismaService } from '../prisma/prisma.service';

const ORG = 'org-1';
const OTHER_ORG = 'org-2';

interface StockKey {
  organisationId: string;
  productId: string;
  locationId: string;
}

function stockKey(k: StockKey): string {
  return `${k.organisationId}:${k.productId}:${k.locationId}`;
}

function makeRepository(options?: {
  initialStock?: { key: StockKey; quantityOnHand: number; averageUnitCost: number };
  initialPartUsage?: Record<string, unknown>;
}) {
  const partUsages = new Map<string, Record<string, unknown>>();
  const stock = new Map<string, Record<string, unknown>>();
  const transactions: Record<string, unknown>[] = [];
  let seq = 0;

  if (options?.initialPartUsage) {
    partUsages.set(options.initialPartUsage.id as string, options.initialPartUsage);
  }
  if (options?.initialStock) {
    stock.set(stockKey(options.initialStock.key), {
      ...options.initialStock.key,
      quantityOnHand: options.initialStock.quantityOnHand,
      averageUnitCost: options.initialStock.averageUnitCost,
    });
  }

  const tx = {
    maintenancePartUsage: {
      findUnique: jest.fn(
        async ({
          where,
        }: {
          where: {
            organisationId_idempotencyKey?: { organisationId: string; idempotencyKey: string };
            organisationId_issueIdempotencyKey?: {
              organisationId: string;
              issueIdempotencyKey: string;
            };
          };
        }) => {
          const idLookup = where.organisationId_idempotencyKey;
          if (idLookup) {
            for (const row of partUsages.values()) {
              if (
                row.organisationId === idLookup.organisationId &&
                row.idempotencyKey === idLookup.idempotencyKey
              ) {
                return row;
              }
            }
            return null;
          }
          const issueLookup = where.organisationId_issueIdempotencyKey;
          if (issueLookup) {
            for (const row of partUsages.values()) {
              if (
                row.organisationId === issueLookup.organisationId &&
                row.issueIdempotencyKey === issueLookup.issueIdempotencyKey
              ) {
                return row;
              }
            }
            return null;
          }
          return null;
        },
      ),
      findFirst: jest.fn(async ({ where }: { where: { id: string; organisationId: string } }) => {
        const row = partUsages.get(where.id);
        if (!row || row.organisationId !== where.organisationId) return null;
        return row;
      }),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        seq += 1;
        const row = { id: `pu-${seq}`, status: 'REQUESTED', ...data };
        partUsages.set(row.id, row);
        return row;
      }),
      update: jest.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = partUsages.get(where.id);
          if (!row) throw new Error('not found');
          const updated = { ...row, ...data };
          partUsages.set(where.id, updated);
          return updated;
        },
      ),
    },
    inventoryStock: {
      findUnique: jest.fn(
        async ({ where }: { where: { organisationId_productId_locationId: StockKey } }) => {
          return stock.get(stockKey(where.organisationId_productId_locationId)) ?? null;
        },
      ),
      upsert: jest.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: { organisationId_productId_locationId: StockKey };
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => {
          const key = stockKey(where.organisationId_productId_locationId);
          const existing = stock.get(key);
          const row = existing ? { ...existing, ...update } : { ...create };
          stock.set(key, row);
          return row;
        },
      ),
    },
    inventoryTransaction: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `txn-${transactions.length + 1}`, ...data };
        transactions.push(row);
        return row;
      }),
    },
  };

  const prisma = {
    $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb(tx)),
  } as unknown as PrismaService;

  return {
    repository: new MaintenancePartUsageRepository(prisma),
    partUsages,
    stock,
    transactions,
  };
}

describe('MaintenancePartUsageRepository.issue', () => {
  it('deducts stock, creates an InventoryTransaction, and snapshots unitCost/totalCost from InventoryStock.averageUnitCost', async () => {
    const { repository, stock, transactions } = makeRepository({
      initialPartUsage: {
        id: 'pu-1',
        organisationId: ORG,
        productId: 'prod-1',
        quantity: 5,
        status: 'REQUESTED',
      },
      initialStock: {
        key: { organisationId: ORG, productId: 'prod-1', locationId: 'loc-1' },
        quantityOnHand: 20,
        averageUnitCost: 150,
      },
    });

    const result = await repository.issue({
      organisationId: ORG,
      partUsageId: 'pu-1',
      locationId: 'loc-1',
      issuedById: 'user-1',
    });

    expect(result.wasIssued).toBe(true);
    expect(result.partUsage.status).toBe('ISSUED');
    expect(result.partUsage.unitCost).toBe(150);
    expect(result.partUsage.totalCost).toBe(750);
    expect(stock.get(`${ORG}:prod-1:loc-1`)?.quantityOnHand).toBe(15);
    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({
      transactionType: 'ISSUE',
      quantity: 5,
      referenceType: 'MaintenancePartUsage',
      referenceId: 'pu-1',
    });
    expect(result.partUsage.inventoryTransactionId).toBe(transactions[0]!.id);
  });

  it('rejects when requested quantity exceeds InventoryStock.quantityOnHand', async () => {
    const { repository, transactions } = makeRepository({
      initialPartUsage: {
        id: 'pu-1',
        organisationId: ORG,
        productId: 'prod-1',
        quantity: 50,
        status: 'REQUESTED',
      },
      initialStock: {
        key: { organisationId: ORG, productId: 'prod-1', locationId: 'loc-1' },
        quantityOnHand: 10,
        averageUnitCost: 150,
      },
    });

    await expect(
      repository.issue({
        organisationId: ORG,
        partUsageId: 'pu-1',
        locationId: 'loc-1',
        issuedById: 'user-1',
      }),
    ).rejects.toThrow(InsufficientStockError);
    expect(transactions).toHaveLength(0);
  });

  it('rejects a cross-tenant part usage id', async () => {
    const { repository } = makeRepository({
      initialPartUsage: {
        id: 'pu-1',
        organisationId: OTHER_ORG,
        productId: 'prod-1',
        quantity: 5,
        status: 'REQUESTED',
      },
    });

    await expect(
      repository.issue({
        organisationId: ORG,
        partUsageId: 'pu-1',
        locationId: 'loc-1',
        issuedById: 'user-1',
      }),
    ).rejects.toThrow(PartUsageNotFoundError);
  });

  it('rejects issuing an already-CANCELLED part usage', async () => {
    const { repository } = makeRepository({
      initialPartUsage: {
        id: 'pu-1',
        organisationId: ORG,
        productId: 'prod-1',
        quantity: 5,
        status: 'CANCELLED',
      },
    });

    await expect(
      repository.issue({
        organisationId: ORG,
        partUsageId: 'pu-1',
        locationId: 'loc-1',
        issuedById: 'user-1',
      }),
    ).rejects.toThrow(PartUsageStatusConflictError);
  });

  it('idempotent replay: a duplicate issueIdempotencyKey returns the original result with no duplicate stock deduction or InventoryTransaction', async () => {
    const { repository, stock, transactions } = makeRepository({
      initialPartUsage: {
        id: 'pu-1',
        organisationId: ORG,
        productId: 'prod-1',
        quantity: 5,
        status: 'REQUESTED',
      },
      initialStock: {
        key: { organisationId: ORG, productId: 'prod-1', locationId: 'loc-1' },
        quantityOnHand: 20,
        averageUnitCost: 150,
      },
    });

    const first = await repository.issue({
      organisationId: ORG,
      partUsageId: 'pu-1',
      locationId: 'loc-1',
      issuedById: 'user-1',
      issueIdempotencyKey: 'issue-dup',
    });
    const second = await repository.issue({
      organisationId: ORG,
      partUsageId: 'pu-1',
      locationId: 'loc-1',
      issuedById: 'user-1',
      issueIdempotencyKey: 'issue-dup',
    });

    expect(first.wasIssued).toBe(true);
    expect(second.wasIssued).toBe(false);
    expect(second.partUsage.id).toBe(first.partUsage.id);
    expect(transactions).toHaveLength(1);
    expect(stock.get(`${ORG}:prod-1:loc-1`)?.quantityOnHand).toBe(15);
  });

  it('bare repeat issue() with no issueIdempotencyKey against an already-ISSUED row is a no-op, not a duplicate', async () => {
    const { repository, transactions } = makeRepository({
      initialPartUsage: {
        id: 'pu-1',
        organisationId: ORG,
        productId: 'prod-1',
        quantity: 5,
        status: 'ISSUED',
        totalCost: 750,
      },
    });

    const result = await repository.issue({
      organisationId: ORG,
      partUsageId: 'pu-1',
      locationId: 'loc-1',
      issuedById: 'user-1',
    });

    expect(result.wasIssued).toBe(false);
    expect(transactions).toHaveLength(0);
  });
});

describe('MaintenancePartUsageRepository.cancel', () => {
  it('transitions REQUESTED to CANCELLED', async () => {
    const { repository } = makeRepository({
      initialPartUsage: { id: 'pu-1', organisationId: ORG, status: 'REQUESTED' },
    });
    const result = await repository.cancel({
      organisationId: ORG,
      partUsageId: 'pu-1',
      cancelledById: 'user-1',
    });
    expect(result.partUsage.status).toBe('CANCELLED');
  });

  it('is idempotent against an already-CANCELLED row', async () => {
    const { repository } = makeRepository({
      initialPartUsage: { id: 'pu-1', organisationId: ORG, status: 'CANCELLED' },
    });
    const result = await repository.cancel({
      organisationId: ORG,
      partUsageId: 'pu-1',
      cancelledById: 'user-1',
    });
    expect(result.partUsage.status).toBe('CANCELLED');
  });

  it('rejects cancelling an already-ISSUED row', async () => {
    const { repository } = makeRepository({
      initialPartUsage: { id: 'pu-1', organisationId: ORG, status: 'ISSUED' },
    });
    await expect(
      repository.cancel({ organisationId: ORG, partUsageId: 'pu-1', cancelledById: 'user-1' }),
    ).rejects.toThrow(PartUsageStatusConflictError);
  });
});
