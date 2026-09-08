import {
  AmbiguousMeterError,
  IncompleteMandatoryTasksError,
  WorkOrderRepository,
} from './work-order.repository';
import { PrismaService } from '../prisma/prisma.service';

const ORG = 'org-1';

function makeRepository(options: {
  workOrder: Record<string, unknown>;
  tasks?: Record<string, unknown>[];
  meters?: Record<string, unknown>[];
  downtimes?: Record<string, unknown>[];
}) {
  const workOrders = new Map<string, Record<string, unknown>>([
    [options.workOrder.id as string, { ...options.workOrder, tasks: options.tasks ?? [] }],
  ]);
  const tasks = options.tasks ?? [];
  const meters = new Map<string, Record<string, unknown>>(
    (options.meters ?? []).map((m) => [m.id as string, m]),
  );
  const downtimes = new Map<string, Record<string, unknown>>(
    (options.downtimes ?? []).map((d) => [d.id as string, d]),
  );
  const readings: Record<string, unknown>[] = [];

  const tx = {
    workOrder: {
      findFirstOrThrow: jest.fn(
        async ({ where }: { where: { id: string; organisationId: string } }) => {
          const row = workOrders.get(where.id);
          if (!row || row.organisationId !== where.organisationId) throw new Error('not found');
          return { ...row, tasks };
        },
      ),
      update: jest.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = workOrders.get(where.id);
          if (!row) throw new Error('not found');
          const updated = { ...row, ...data };
          workOrders.set(where.id, updated);
          return updated;
        },
      ),
    },
    assetDowntime: {
      findFirst: jest.fn(
        async ({
          where,
        }: {
          where: { organisationId: string; workOrderId: string; endedAt: null };
        }) => {
          for (const row of downtimes.values()) {
            if (
              row.organisationId === where.organisationId &&
              row.workOrderId === where.workOrderId &&
              row.endedAt === null
            ) {
              return row;
            }
          }
          return null;
        },
      ),
      update: jest.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = downtimes.get(where.id);
          if (!row) throw new Error('not found');
          const updated = { ...row, ...data };
          downtimes.set(where.id, updated);
          return updated;
        },
      ),
    },
    assetMeter: {
      findMany: jest.fn(async ({ where }: { where: { organisationId: string; assetId: string } }) =>
        [...meters.values()].filter(
          (m) => m.organisationId === where.organisationId && m.assetId === where.assetId,
        ),
      ),
      findFirstOrThrow: jest.fn(async ({ where }: { where: { id: string } }) => {
        const row = meters.get(where.id);
        if (!row) throw new Error('not found');
        return row;
      }),
      findUniqueOrThrow: jest.fn(async ({ where }: { where: { id: string } }) => {
        const row = meters.get(where.id);
        if (!row) throw new Error('not found');
        return row;
      }),
      update: jest.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = meters.get(where.id);
          if (!row) throw new Error('not found');
          const updated = { ...row, ...data };
          meters.set(where.id, updated);
          return updated;
        },
      ),
    },
    assetMeterReading: {
      findUnique: jest.fn(async () => null),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `reading-${readings.length + 1}`, ...data };
        readings.push(row);
        return row;
      }),
    },
  };

  const prisma = {
    $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb(tx)),
  } as unknown as PrismaService;

  return { repository: new WorkOrderRepository(prisma), workOrders, downtimes, readings };
}

describe('WorkOrderRepository.complete', () => {
  it('completes successfully when every mandatory task is COMPLETED', async () => {
    const { repository } = makeRepository({
      workOrder: { id: 'wo-1', organisationId: ORG, assetId: 'asset-1', status: 'IN_PROGRESS' },
      tasks: [
        { id: 't1', mandatory: true, status: 'COMPLETED', title: 'Inspect oil' },
        { id: 't2', mandatory: false, status: 'PENDING', title: 'Optional check' },
      ],
    });

    const result = await repository.complete({
      organisationId: ORG,
      workOrderId: 'wo-1',
      resolution: 'Replaced oil filter',
      actorUserId: 'user-1',
    });

    expect(result.wasCompleted).toBe(true);
    expect(result.workOrder.status).toBe('COMPLETED');
    expect(result.workOrder.resolution).toBe('Replaced oil filter');
  });

  it('rejects completion when a mandatory task is still incomplete', async () => {
    const { repository } = makeRepository({
      workOrder: { id: 'wo-1', organisationId: ORG, assetId: 'asset-1', status: 'IN_PROGRESS' },
      tasks: [{ id: 't1', mandatory: true, status: 'PENDING', title: 'Inspect oil' }],
    });

    await expect(
      repository.complete({
        organisationId: ORG,
        workOrderId: 'wo-1',
        resolution: 'Done',
        actorUserId: 'user-1',
      }),
    ).rejects.toThrow(IncompleteMandatoryTasksError);
  });

  it('allows completion when a non-mandatory task is still pending', async () => {
    const { repository } = makeRepository({
      workOrder: { id: 'wo-1', organisationId: ORG, assetId: 'asset-1', status: 'IN_PROGRESS' },
      tasks: [{ id: 't1', mandatory: false, status: 'PENDING', title: 'Optional' }],
    });

    const result = await repository.complete({
      organisationId: ORG,
      workOrderId: 'wo-1',
      resolution: 'Done',
      actorUserId: 'user-1',
    });
    expect(result.wasCompleted).toBe(true);
  });

  it('auto-closes any still-open downtime window at completion', async () => {
    const { repository, downtimes } = makeRepository({
      workOrder: { id: 'wo-1', organisationId: ORG, assetId: 'asset-1', status: 'IN_PROGRESS' },
      tasks: [],
      downtimes: [
        {
          id: 'dt-1',
          organisationId: ORG,
          workOrderId: 'wo-1',
          startedAt: new Date('2026-01-01T08:00:00Z'),
          endedAt: null,
        },
      ],
    });

    await repository.complete({
      organisationId: ORG,
      workOrderId: 'wo-1',
      resolution: 'Done',
      actorUserId: 'user-1',
    });

    expect(downtimes.get('dt-1')!.endedAt).not.toBeNull();
  });

  it('records a meter reading via the shared, transaction-joinable meter function when the asset has exactly one meter', async () => {
    const { repository, readings } = makeRepository({
      workOrder: { id: 'wo-1', organisationId: ORG, assetId: 'asset-1', status: 'IN_PROGRESS' },
      tasks: [],
      meters: [
        {
          id: 'meter-1',
          organisationId: ORG,
          assetId: 'asset-1',
          meterType: 'HOURS',
          currentReading: 4000,
        },
      ],
    });

    const result = await repository.complete({
      organisationId: ORG,
      workOrderId: 'wo-1',
      resolution: 'Done',
      meterReading: 4500,
      actorUserId: 'user-1',
    });

    expect(readings).toHaveLength(1);
    expect(result.workOrder.meterReadingId).toBe(readings[0]!.id);
  });

  it('rejects an ambiguous meter reading when the asset has more than one meter and none is specified', async () => {
    const { repository } = makeRepository({
      workOrder: { id: 'wo-1', organisationId: ORG, assetId: 'asset-1', status: 'IN_PROGRESS' },
      tasks: [],
      meters: [
        {
          id: 'meter-1',
          organisationId: ORG,
          assetId: 'asset-1',
          meterType: 'HOURS',
          currentReading: 4000,
        },
        {
          id: 'meter-2',
          organisationId: ORG,
          assetId: 'asset-1',
          meterType: 'KILOMETERS',
          currentReading: 1000,
        },
      ],
    });

    await expect(
      repository.complete({
        organisationId: ORG,
        workOrderId: 'wo-1',
        resolution: 'Done',
        meterReading: 4500,
        actorUserId: 'user-1',
      }),
    ).rejects.toThrow(AmbiguousMeterError);
  });

  it('idempotent replay: completing an already-COMPLETED work order returns it unchanged, no re-validation', async () => {
    const { repository } = makeRepository({
      workOrder: {
        id: 'wo-1',
        organisationId: ORG,
        assetId: 'asset-1',
        status: 'COMPLETED',
        resolution: 'Original resolution',
      },
      tasks: [],
    });

    const result = await repository.complete({
      organisationId: ORG,
      workOrderId: 'wo-1',
      resolution: 'A different resolution text',
      actorUserId: 'user-1',
    });

    expect(result.wasCompleted).toBe(false);
    expect(result.workOrder.resolution).toBe('Original resolution');
  });
});
