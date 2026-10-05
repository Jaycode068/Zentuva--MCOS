import { CollectionPointFulfillmentStatus } from '@prisma/client';

import { CollectionPointFulfillmentRepository } from './collection-point-fulfillment.repository';

/**
 * Sprint 37 — a simple direct jest-mock map-backed fixture, the same convention
 * `finance/payment.repository.spec.ts`'s D2C block established for testing a
 * conditional-`updateMany` repository in isolation, independent of any complex
 * fake-transaction harness.
 */
function makeSimplePrisma() {
  const rows = new Map<string, Record<string, unknown>>();
  return {
    rows,
    collectionPointFulfillment: {
      create: jest.fn((args: { data: Record<string, unknown> }) => {
        const id = `cpf-${rows.size + 1}`;
        const row = {
          id,
          organisationId: (args.data.organisation as { connect: { id: string } }).connect.id,
          salesOrderId: (args.data.salesOrder as { connect: { id: string } }).connect.id,
          outletId: (args.data.outlet as { connect: { id: string } }).connect.id,
          status: CollectionPointFulfillmentStatus.ASSIGNED,
          assignedAt: new Date(),
          preparingAt: null,
          readyAt: null,
          collectedAt: null,
          collectedById: null,
          outlet: { id: 'outlet-1', name: 'Test Outlet', collectionPointResponsibleUserId: null },
          salesOrder: {
            id: 'so-1',
            orderCode: 'SO-000001',
            status: 'CONFIRMED',
            consumerId: 'c-1',
          },
        };
        rows.set(id, row);
        return Promise.resolve(row);
      }),
      findFirst: jest.fn((args: { where: Record<string, unknown> }) => {
        const match = [...rows.values()].find((row) =>
          Object.entries(args.where).every(([key, value]) => row[key] === value),
        );
        return Promise.resolve(match ?? null);
      }),
      findMany: jest.fn((args: { where: Record<string, unknown> }) => {
        const matches = [...rows.values()].filter((row) =>
          Object.entries(args.where).every(([key, value]) => {
            if (value && typeof value === 'object' && 'in' in (value as object)) {
              return (value as { in: unknown[] }).in.includes(row[key]);
            }
            return row[key] === value;
          }),
        );
        return Promise.resolve(matches);
      }),
      updateMany: jest.fn(
        (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          const statusFilter = args.where.status as { in: string[] } | undefined;
          let count = 0;
          for (const row of rows.values()) {
            if (
              row.id === args.where.id &&
              row.organisationId === args.where.organisationId &&
              (!statusFilter || statusFilter.in.includes(row.status as string))
            ) {
              Object.assign(row, args.data);
              count += 1;
            }
          }
          return Promise.resolve({ count });
        },
      ),
      findUniqueOrThrow: jest.fn((args: { where: { id: string } }) =>
        Promise.resolve(rows.get(args.where.id)),
      ),
    },
  };
}

describe('CollectionPointFulfillmentRepository', () => {
  function makeRepository() {
    const prisma = makeSimplePrisma();
    const repository = new CollectionPointFulfillmentRepository(prisma as never);
    return { repository, prisma };
  }

  it('creates a row and finds it by salesOrderId, tenant-scoped', async () => {
    const { repository } = makeRepository();
    const created = await repository.create({
      organisation: { connect: { id: 'org-1' } },
      salesOrder: { connect: { id: 'so-1' } },
      outlet: { connect: { id: 'outlet-1' } },
    } as never);

    const found = await repository.findBySalesOrderId('org-1', 'so-1');
    expect(found?.id).toBe(created.id);

    const crossTenant = await repository.findBySalesOrderId('org-2', 'so-1');
    expect(crossTenant).toBeNull();
  });

  describe('updateStatus', () => {
    it('transitions when the current status matches fromStatuses', async () => {
      const { repository } = makeRepository();
      const created = await repository.create({
        organisation: { connect: { id: 'org-1' } },
        salesOrder: { connect: { id: 'so-1' } },
        outlet: { connect: { id: 'outlet-1' } },
      } as never);

      const updated = await repository.updateStatus(
        'org-1',
        created.id,
        [CollectionPointFulfillmentStatus.ASSIGNED],
        { status: CollectionPointFulfillmentStatus.PREPARING },
      );
      expect(updated?.status).toBe(CollectionPointFulfillmentStatus.PREPARING);
    });

    it('returns null (no-op) when the current status does not match fromStatuses', async () => {
      const { repository } = makeRepository();
      const created = await repository.create({
        organisation: { connect: { id: 'org-1' } },
        salesOrder: { connect: { id: 'so-1' } },
        outlet: { connect: { id: 'outlet-1' } },
      } as never);

      const result = await repository.updateStatus(
        'org-1',
        created.id,
        [CollectionPointFulfillmentStatus.READY_FOR_COLLECTION],
        { status: CollectionPointFulfillmentStatus.COLLECTED },
      );
      expect(result).toBeNull();
    });

    it('returns null for a cross-tenant id, never mutating another tenant row', async () => {
      const { repository } = makeRepository();
      const created = await repository.create({
        organisation: { connect: { id: 'org-1' } },
        salesOrder: { connect: { id: 'so-1' } },
        outlet: { connect: { id: 'outlet-1' } },
      } as never);

      const result = await repository.updateStatus(
        'org-2',
        created.id,
        [CollectionPointFulfillmentStatus.ASSIGNED],
        { status: CollectionPointFulfillmentStatus.PREPARING },
      );
      expect(result).toBeNull();
    });
  });

  /** Added Sprint 39 — the admin reassignment override's conditional `updateMany`, the
   *  exact same concurrency primitive as `updateStatus` above, just with a different
   *  target field (`outletId`) and a fixed destination status. */
  describe('reassignOutlet', () => {
    it('moves outletId and resets to ASSIGNED+preparingAt null when the current status matches', async () => {
      const { repository } = makeRepository();
      const created = await repository.create({
        organisation: { connect: { id: 'org-1' } },
        salesOrder: { connect: { id: 'so-1' } },
        outlet: { connect: { id: 'outlet-1' } },
      } as never);
      await repository.updateStatus(
        'org-1',
        created.id,
        [CollectionPointFulfillmentStatus.ASSIGNED],
        { status: CollectionPointFulfillmentStatus.PREPARING, preparingAt: new Date() },
      );

      const result = await repository.reassignOutlet(
        'org-1',
        created.id,
        [CollectionPointFulfillmentStatus.ASSIGNED, CollectionPointFulfillmentStatus.PREPARING],
        'outlet-2',
      );

      expect(result?.outletId).toBe('outlet-2');
      expect(result?.status).toBe(CollectionPointFulfillmentStatus.ASSIGNED);
      expect(result?.preparingAt).toBeNull();
    });

    it('returns null (no-op) when the current status is not reassignable (e.g. already COLLECTED)', async () => {
      const { repository } = makeRepository();
      const created = await repository.create({
        organisation: { connect: { id: 'org-1' } },
        salesOrder: { connect: { id: 'so-1' } },
        outlet: { connect: { id: 'outlet-1' } },
      } as never);
      await repository.updateStatus(
        'org-1',
        created.id,
        [CollectionPointFulfillmentStatus.ASSIGNED],
        { status: CollectionPointFulfillmentStatus.COLLECTED },
      );

      const result = await repository.reassignOutlet(
        'org-1',
        created.id,
        [CollectionPointFulfillmentStatus.ASSIGNED, CollectionPointFulfillmentStatus.PREPARING],
        'outlet-2',
      );
      expect(result).toBeNull();
    });

    it('returns null for a cross-tenant id, never mutating another tenant row', async () => {
      const { repository } = makeRepository();
      const created = await repository.create({
        organisation: { connect: { id: 'org-1' } },
        salesOrder: { connect: { id: 'so-1' } },
        outlet: { connect: { id: 'outlet-1' } },
      } as never);

      const result = await repository.reassignOutlet(
        'org-2',
        created.id,
        [CollectionPointFulfillmentStatus.ASSIGNED],
        'outlet-2',
      );
      expect(result).toBeNull();
    });
  });
});
