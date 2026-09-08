import { addFrequency, MaintenanceScheduleRepository } from './maintenance-schedule.repository';
import { PrismaService } from '../prisma/prisma.service';

const ORG = 'org-1';

function makeRepository(options: {
  schedule: Record<string, unknown>;
  plan: Record<string, unknown>;
  asset: Record<string, unknown>;
  meters?: Record<string, unknown>[];
}) {
  const schedules = new Map<string, Record<string, unknown>>([
    [options.schedule.id as string, options.schedule],
  ]);
  const workOrders = new Map<string, Record<string, unknown>>();
  const meters = new Map<string, Record<string, unknown>>(
    (options.meters ?? []).map((m) => [m.id as string, m]),
  );
  let sequence = 0;

  const tx = {
    maintenanceSchedule: {
      findFirstOrThrow: jest.fn(
        async ({ where }: { where: { id: string; organisationId: string } }) => {
          const row = schedules.get(where.id);
          if (!row || row.organisationId !== where.organisationId) throw new Error('not found');
          return row;
        },
      ),
      update: jest.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = schedules.get(where.id);
          if (!row) throw new Error('not found');
          const updated = { ...row, ...data };
          schedules.set(where.id, updated);
          return updated;
        },
      ),
    },
    workOrder: {
      findFirst: jest.fn(async () => null),
      findUnique: jest.fn(
        async ({ where }: { where: { organisationId_workOrderCode?: unknown } }) => {
          void where;
          return null;
        },
      ),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        sequence += 1;
        const row = { id: `wo-${sequence}`, ...data };
        workOrders.set(row.id, row);
        return row;
      }),
    },
    maintenancePlan: {
      findUniqueOrThrow: jest.fn(async () => ({ ...options.plan, tasks: [] })),
    },
    asset: {
      findUniqueOrThrow: jest.fn(async () => options.asset),
    },
    assetMeter: {
      findFirst: jest.fn(
        async ({
          where,
        }: {
          where: { organisationId: string; assetId: string; meterType: string };
        }) =>
          [...meters.values()].find(
            (m) =>
              m.organisationId === where.organisationId &&
              m.assetId === where.assetId &&
              m.meterType === where.meterType,
          ) ?? null,
      ),
    },
  };

  const prisma = {
    $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb(tx)),
  } as unknown as PrismaService;

  return { repository: new MaintenanceScheduleRepository(prisma), schedules, workOrders };
}

describe('addFrequency', () => {
  it('steps forward by the given unit', () => {
    expect(addFrequency(new Date('2026-01-01'), 30, 'DAYS').toISOString().slice(0, 10)).toBe(
      '2026-01-31',
    );
    expect(addFrequency(new Date('2026-01-01'), 1, 'MONTHS').toISOString().slice(0, 10)).toBe(
      '2026-02-01',
    );
    expect(addFrequency(new Date('2026-01-01'), 1, 'YEARS').toISOString().slice(0, 10)).toBe(
      '2027-01-01',
    );
  });
});

describe('MaintenanceScheduleRepository.generate — date-based', () => {
  const plan = {
    id: 'plan-1',
    maintenanceTypeId: 'type-1',
    name: 'Compressor Monthly Service',
    priority: 'MEDIUM',
  };
  const asset = { id: 'asset-1', name: 'Compressor' };

  it('creates a work order when due and advances nextDueDate to the next occurrence', async () => {
    const { repository, schedules, workOrders } = makeRepository({
      schedule: {
        id: 'sch-1',
        organisationId: ORG,
        maintenancePlanId: 'plan-1',
        assetId: 'asset-1',
        scheduleType: 'DATE_BASED',
        frequencyValue: 30,
        frequencyUnit: 'DAYS',
        nextDueDate: new Date('2020-01-01'), // long past — always due
        status: 'ACTIVE',
      },
      plan,
      asset,
    });

    const result = await repository.generate(ORG, 'sch-1', 'user-1');

    expect(result.generated).toBe(true);
    expect(workOrders.size).toBe(1);
    const updatedSchedule = schedules.get('sch-1')!;
    expect((updatedSchedule.nextDueDate as Date).getTime()).toBeGreaterThan(
      new Date('2020-01-01').getTime(),
    );
  });

  it('is idempotent by construction: a second immediate call finds nothing due, creates no duplicate', async () => {
    // Due yesterday (not years overdue) — advancing by one 30-day interval
    // lands safely in the future, so the second call correctly finds
    // nothing due. A schedule overdue by *multiple* periods legitimately
    // catches up one period per call — that is intentional, not a bug.
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const { repository, workOrders } = makeRepository({
      schedule: {
        id: 'sch-1',
        organisationId: ORG,
        maintenancePlanId: 'plan-1',
        assetId: 'asset-1',
        scheduleType: 'DATE_BASED',
        frequencyValue: 30,
        frequencyUnit: 'DAYS',
        nextDueDate: yesterday,
        status: 'ACTIVE',
      },
      plan,
      asset,
    });

    const first = await repository.generate(ORG, 'sch-1', 'user-1');
    const second = await repository.generate(ORG, 'sch-1', 'user-1');

    expect(first.generated).toBe(true);
    expect(second.generated).toBe(false);
    expect(second.reason).toBe('not_due');
    expect(workOrders.size).toBe(1);
  });

  it('does nothing when not yet due', async () => {
    const { repository, workOrders } = makeRepository({
      schedule: {
        id: 'sch-1',
        organisationId: ORG,
        maintenancePlanId: 'plan-1',
        assetId: 'asset-1',
        scheduleType: 'DATE_BASED',
        frequencyValue: 30,
        frequencyUnit: 'DAYS',
        nextDueDate: new Date('2099-01-01'), // far future
        status: 'ACTIVE',
      },
      plan,
      asset,
    });

    const result = await repository.generate(ORG, 'sch-1', 'user-1');
    expect(result.generated).toBe(false);
    expect(result.reason).toBe('not_due');
    expect(workOrders.size).toBe(0);
  });

  it('does nothing when the schedule is inactive', async () => {
    const { repository } = makeRepository({
      schedule: {
        id: 'sch-1',
        organisationId: ORG,
        maintenancePlanId: 'plan-1',
        assetId: 'asset-1',
        scheduleType: 'DATE_BASED',
        frequencyValue: 30,
        frequencyUnit: 'DAYS',
        nextDueDate: new Date('2020-01-01'),
        status: 'INACTIVE',
      },
      plan,
      asset,
    });

    const result = await repository.generate(ORG, 'sch-1', 'user-1');
    expect(result.generated).toBe(false);
    expect(result.reason).toBe('inactive');
  });
});

describe('MaintenanceScheduleRepository.generate — meter-based', () => {
  const plan = {
    id: 'plan-1',
    maintenanceTypeId: 'type-1',
    name: 'Compressor 500hr Service',
    priority: 'MEDIUM',
  };
  const asset = { id: 'asset-1', name: 'Compressor' };

  it('creates a work order once the meter reaches the threshold, advancing the threshold by the interval', async () => {
    const { repository, schedules, workOrders } = makeRepository({
      schedule: {
        id: 'sch-1',
        organisationId: ORG,
        maintenancePlanId: 'plan-1',
        assetId: 'asset-1',
        scheduleType: 'METER_BASED',
        meterType: 'HOURS',
        meterInterval: 500,
        nextDueMeterReading: 4500,
        status: 'ACTIVE',
      },
      plan,
      asset,
      meters: [
        {
          id: 'meter-1',
          organisationId: ORG,
          assetId: 'asset-1',
          meterType: 'HOURS',
          currentReading: 4850,
        },
      ],
    });

    const result = await repository.generate(ORG, 'sch-1', 'user-1');

    expect(result.generated).toBe(true);
    expect(workOrders.size).toBe(1);
    expect(schedules.get('sch-1')!.nextDueMeterReading).toBe(5350); // 4850 + 500
  });

  it('does nothing when the current reading has not reached the threshold', async () => {
    const { repository, workOrders } = makeRepository({
      schedule: {
        id: 'sch-1',
        organisationId: ORG,
        maintenancePlanId: 'plan-1',
        assetId: 'asset-1',
        scheduleType: 'METER_BASED',
        meterType: 'HOURS',
        meterInterval: 500,
        nextDueMeterReading: 5000,
        status: 'ACTIVE',
      },
      plan,
      asset,
      meters: [
        {
          id: 'meter-1',
          organisationId: ORG,
          assetId: 'asset-1',
          meterType: 'HOURS',
          currentReading: 4850,
        },
      ],
    });

    const result = await repository.generate(ORG, 'sch-1', 'user-1');
    expect(result.generated).toBe(false);
    expect(result.reason).toBe('not_due');
    expect(workOrders.size).toBe(0);
  });

  it('reports no_meter when the asset has no meter of the requested type', async () => {
    const { repository } = makeRepository({
      schedule: {
        id: 'sch-1',
        organisationId: ORG,
        maintenancePlanId: 'plan-1',
        assetId: 'asset-1',
        scheduleType: 'METER_BASED',
        meterType: 'HOURS',
        meterInterval: 500,
        nextDueMeterReading: 4500,
        status: 'ACTIVE',
      },
      plan,
      asset,
      meters: [],
    });

    const result = await repository.generate(ORG, 'sch-1', 'user-1');
    expect(result.generated).toBe(false);
    expect(result.reason).toBe('no_meter');
  });
});
