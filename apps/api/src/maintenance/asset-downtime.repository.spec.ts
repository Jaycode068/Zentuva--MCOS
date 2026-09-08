import { BadRequestException } from '@nestjs/common';

import { AssetDowntimeRepository } from './asset-downtime.repository';
import { PrismaService } from '../prisma/prisma.service';

const ORG = 'org-1';

function makeRepository() {
  const downtimes = new Map<string, Record<string, unknown>>();
  let seq = 0;

  const tx = {
    assetDowntime: {
      findUnique: jest.fn(async () => null),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        seq += 1;
        const row = { id: `dt-${seq}`, ...data };
        downtimes.set(row.id, row);
        return row;
      }),
    },
  };

  const prisma = {
    $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb(tx)),
    assetDowntime: {
      findFirst: jest.fn(async ({ where }: { where: { id: string; organisationId: string } }) => {
        const row = downtimes.get(where.id);
        return row && row.organisationId === where.organisationId ? row : null;
      }),
      updateMany: jest.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = downtimes.get(where.id);
          if (!row) return { count: 0 };
          downtimes.set(where.id, { ...row, ...data });
          return { count: 1 };
        },
      ),
      findUniqueOrThrow: jest.fn(async ({ where }: { where: { id: string } }) =>
        downtimes.get(where.id),
      ),
    },
  } as unknown as PrismaService;

  return { repository: new AssetDowntimeRepository(prisma), downtimes };
}

describe('AssetDowntimeRepository', () => {
  it('rejects a negative duration (endedAt before startedAt) at record time', async () => {
    const { repository } = makeRepository();
    await expect(
      repository.record({
        organisationId: ORG,
        assetId: 'asset-1',
        workOrderId: 'wo-1',
        startedAt: new Date('2026-01-02T00:00:00Z'),
        endedAt: new Date('2026-01-01T00:00:00Z'),
        planned: false,
        recordedById: 'user-1',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('accepts an open-ended downtime window (no endedAt)', async () => {
    const { repository, downtimes } = makeRepository();
    const result = await repository.record({
      organisationId: ORG,
      assetId: 'asset-1',
      workOrderId: 'wo-1',
      startedAt: new Date('2026-01-01T08:00:00Z'),
      planned: false,
      recordedById: 'user-1',
    });
    expect(result.wasCreated).toBe(true);
    expect(downtimes.get(result.downtime.id)!.endedAt).toBeUndefined();
  });

  it('rejects ending a downtime window before its own start', async () => {
    const { repository } = makeRepository();
    const created = await repository.record({
      organisationId: ORG,
      assetId: 'asset-1',
      workOrderId: 'wo-1',
      startedAt: new Date('2026-01-01T08:00:00Z'),
      planned: false,
      recordedById: 'user-1',
    });
    await expect(
      repository.end(ORG, created.downtime.id, new Date('2026-01-01T07:00:00Z')),
    ).rejects.toThrow(BadRequestException);
  });

  it('end() is idempotent — ending an already-ended window returns it unchanged', async () => {
    const { repository } = makeRepository();
    const created = await repository.record({
      organisationId: ORG,
      assetId: 'asset-1',
      workOrderId: 'wo-1',
      startedAt: new Date('2026-01-01T08:00:00Z'),
      endedAt: new Date('2026-01-01T10:00:00Z'),
      planned: false,
      recordedById: 'user-1',
    });
    const result = await repository.end(ORG, created.downtime.id, new Date('2026-01-01T12:00:00Z'));
    expect(result.endedAt).toEqual(new Date('2026-01-01T10:00:00Z'));
  });
});
