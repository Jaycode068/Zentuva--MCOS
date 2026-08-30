import { CashflowForecastSourceType } from '@prisma/client';

import { CashflowAdjustmentRepository } from './cashflow-adjustment.repository';
import { PrismaService } from '../../prisma/prisma.service';

function key(organisationId: string, sourceType: string, sourceId: string): string {
  return `${organisationId}|${sourceType}|${sourceId}`;
}

function makeFakeTx() {
  const adjustments = new Map<string, Record<string, unknown>>();
  let sequence = 0;

  const tx = {
    cashflowForecastAdjustment: {
      findFirst: jest.fn(
        async ({ where }: { where: { organisationId: string; idempotencyKey: string } }) => {
          for (const adjustment of adjustments.values()) {
            if (
              adjustment.organisationId === where.organisationId &&
              adjustment.idempotencyKey === where.idempotencyKey
            ) {
              return adjustment;
            }
          }
          return null;
        },
      ),
      findUnique: jest.fn(
        async ({
          where,
        }: {
          where: {
            organisationId_sourceType_sourceId: {
              organisationId: string;
              sourceType: string;
              sourceId: string;
            };
          };
        }) => {
          const { organisationId, sourceType, sourceId } = where.organisationId_sourceType_sourceId;
          return adjustments.get(key(organisationId, sourceType, sourceId)) ?? null;
        },
      ),
      upsert: jest.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: {
            organisationId_sourceType_sourceId: {
              organisationId: string;
              sourceType: string;
              sourceId: string;
            };
          };
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => {
          const { organisationId, sourceType, sourceId } = where.organisationId_sourceType_sourceId;
          const k = key(organisationId, sourceType, sourceId);
          const existing = adjustments.get(k);
          if (existing) {
            Object.assign(existing, update);
            return existing;
          }
          sequence += 1;
          const adjustment = { id: `adj-${sequence}`, ...create };
          adjustments.set(k, adjustment);
          return adjustment;
        },
      ),
    },
  };

  return { tx, adjustments };
}

function makeRepository() {
  const fake = makeFakeTx();
  const prisma = {
    $transaction: jest.fn(async (callback: (tx: unknown) => unknown) => callback(fake.tx)),
  } as unknown as PrismaService;
  return { repository: new CashflowAdjustmentRepository(prisma), ...fake };
}

const ORG = 'org-1';

describe('CashflowAdjustmentRepository.upsert', () => {
  it('creates a new adjustment when none exists for the source item', async () => {
    const { repository } = makeRepository();
    const result = await repository.upsert({
      organisationId: ORG,
      sourceType: CashflowForecastSourceType.CUSTOMER_RECEIVABLE,
      sourceId: 'inv-1',
      adjustedExpectedDate: new Date('2026-09-30'),
      actorUserId: 'user-1',
    });
    expect(result.wasCreated).toBe(true);
    expect(result.adjustment.sourceId).toBe('inv-1');
  });

  it('updates the existing adjustment on a second call for the same source item, not creating a duplicate', async () => {
    const { repository, adjustments } = makeRepository();
    await repository.upsert({
      organisationId: ORG,
      sourceType: CashflowForecastSourceType.CUSTOMER_RECEIVABLE,
      sourceId: 'inv-1',
      adjustedExpectedDate: new Date('2026-09-30'),
      actorUserId: 'user-1',
    });
    const second = await repository.upsert({
      organisationId: ORG,
      sourceType: CashflowForecastSourceType.CUSTOMER_RECEIVABLE,
      sourceId: 'inv-1',
      adjustedAmount: 1_800_000,
      actorUserId: 'user-1',
    });
    expect(second.wasCreated).toBe(false);
    expect(second.adjustment.adjustedAmount).toBe(1_800_000);
    expect(adjustments.size).toBe(1);
  });

  it('is idempotent on a repeated idempotencyKey', async () => {
    const { repository } = makeRepository();
    const input = {
      organisationId: ORG,
      sourceType: CashflowForecastSourceType.SUPPLIER_PAYABLE,
      sourceId: 'sinv-1',
      adjustedAmount: 5_000_000,
      idempotencyKey: 'key-1',
      actorUserId: 'user-1',
    };
    const first = await repository.upsert(input);
    const second = await repository.upsert(input);
    expect(first.wasCreated).toBe(true);
    expect(second.wasCreated).toBe(false);
    expect(second.adjustment.id).toBe(first.adjustment.id);
  });
});
