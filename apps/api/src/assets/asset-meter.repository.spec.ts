import { AssetMeterRepository, InvalidMeterReadingError } from './asset-meter.repository';
import { PrismaService } from '../prisma/prisma.service';

const ORG = 'org-1';

function makeRepository(initialMeter: Record<string, unknown>) {
  const meters = new Map<string, Record<string, unknown>>([
    [initialMeter.id as string, initialMeter],
  ]);
  const readings = new Map<string, Record<string, unknown>>();
  let readingSeq = 0;

  const tx = {
    assetMeter: {
      findFirstOrThrow: jest.fn(
        async ({ where }: { where: { id: string; organisationId: string } }) => {
          const row = meters.get(where.id);
          if (!row || row.organisationId !== where.organisationId) throw new Error('not found');
          return row;
        },
      ),
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
          for (const row of readings.values()) {
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
        readingSeq += 1;
        const id = `reading-${readingSeq}`;
        const row = { id, ...data };
        readings.set(id, row);
        return row;
      }),
    },
  };

  const prisma = {
    $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb(tx)),
  } as unknown as PrismaService;

  return { repository: new AssetMeterRepository(prisma), meters, readings };
}

describe('AssetMeterRepository.recordReading', () => {
  it('accepts a higher reading, updating currentReading/lastReadingDate on the meter', async () => {
    const { repository, meters } = makeRepository({
      id: 'meter-1',
      organisationId: ORG,
      currentReading: 4000,
    });

    const result = await repository.recordReading({
      organisationId: ORG,
      meterId: 'meter-1',
      reading: 4500,
      recordedById: 'user-1',
    });

    expect(result.meter.currentReading).toBe(4500);
    expect(meters.get('meter-1')!.currentReading).toBe(4500);
  });

  it('rejects a reading lower than the current reading — meters are cumulative', async () => {
    const { repository } = makeRepository({
      id: 'meter-1',
      organisationId: ORG,
      currentReading: 4500,
    });

    await expect(
      repository.recordReading({
        organisationId: ORG,
        meterId: 'meter-1',
        reading: 4000,
        recordedById: 'user-1',
      }),
    ).rejects.toThrow(InvalidMeterReadingError);
  });

  it('accepts an equal reading (no movement, but not a decrease)', async () => {
    const { repository } = makeRepository({
      id: 'meter-1',
      organisationId: ORG,
      currentReading: 4500,
    });
    const result = await repository.recordReading({
      organisationId: ORG,
      meterId: 'meter-1',
      reading: 4500,
      recordedById: 'user-1',
    });
    expect(result.meter.currentReading).toBe(4500);
  });

  it('idempotent replay: a duplicate idempotencyKey does not double-record or re-validate against the now-updated reading', async () => {
    const { repository, readings } = makeRepository({
      id: 'meter-1',
      organisationId: ORG,
      currentReading: 4000,
    });

    await repository.recordReading({
      organisationId: ORG,
      meterId: 'meter-1',
      reading: 4500,
      recordedById: 'user-1',
      idempotencyKey: 'reading-dup',
    });
    const second = await repository.recordReading({
      organisationId: ORG,
      meterId: 'meter-1',
      reading: 4500,
      recordedById: 'user-1',
      idempotencyKey: 'reading-dup',
    });

    expect(second.wasCreated).toBe(false);
    expect(readings.size).toBe(1);
  });
});
