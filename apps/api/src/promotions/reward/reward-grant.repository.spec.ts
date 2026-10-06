import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { RewardGrantRepository } from './reward-grant.repository';

/**
 * Sprint 40 — a simple direct jest-mock map-backed fixture, the same convention
 * `finance/payment.repository.spec.ts`'s D2C block / `collection-point-fulfillment
 * .repository.spec.ts` already establish for testing a conditional-write repository in
 * isolation. The genuine concurrent-transaction race (two REAL Postgres connections) is
 * proven separately in `promotions-concurrency.integration.spec.ts` — this file proves
 * the single-process logic: a unique-constraint rejection is caught and resolved to the
 * existing row, and a successful create also earns points atomically.
 */
function makeFakePrisma() {
  const grants = new Map<string, Record<string, unknown>>();
  const accounts = new Map<string, Record<string, unknown>>();
  const ledgerEntries: Record<string, unknown>[] = [];
  let seq = 0;

  const txClient = {
    consumerRewardGrant: {
      create: jest.fn((args: { data: Record<string, unknown> }) => {
        const key = `${args.data.organisationId}:${args.data.promotionId}:${args.data.consumerId}`;
        const collision = [...grants.values()].find(
          (g) =>
            g.organisationId === args.data.organisationId &&
            g.promotionId === args.data.promotionId &&
            g.consumerId === args.data.consumerId,
        );
        if (collision) {
          throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
            code: 'P2002',
            clientVersion: '5.22.0',
          });
        }
        seq += 1;
        const row = { id: `grant-${seq}`, ...args.data };
        grants.set(key, row);
        return Promise.resolve(row);
      }),
    },
    loyaltyAccount: {
      upsert: jest.fn(
        (args: {
          where: { consumerId: string };
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => {
          const existing = accounts.get(args.where.consumerId);
          if (existing) {
            const increment = (args.update.balance as { increment: number }).increment;
            existing.balance = (existing.balance as number) + increment;
            return Promise.resolve({ id: existing.id, balance: existing.balance });
          }
          const row = { id: `acct-${args.where.consumerId}`, balance: args.create.balance };
          accounts.set(args.where.consumerId, row);
          return Promise.resolve(row);
        },
      ),
    },
    loyaltyLedgerEntry: {
      create: jest.fn((args: { data: Record<string, unknown> }) => {
        const row = { id: `ledger-${ledgerEntries.length + 1}`, ...args.data };
        ledgerEntries.push(row);
        return Promise.resolve(row);
      }),
    },
  };

  const prisma = {
    $transaction: jest.fn((fn: (tx: typeof txClient) => Promise<unknown>) => fn(txClient)),
    consumerRewardGrant: {
      findUniqueOrThrow: jest.fn((args: { where: { id: string } }) => {
        const row = [...grants.values()].find((g) => g.id === args.where.id);
        if (!row) throw new Error('not found');
        return Promise.resolve({ ...row, consumer: {}, promotion: {}, qualifyingSalesOrder: {} });
      }),
      findUnique: jest.fn(
        (args: {
          where: {
            organisationId_promotionId_consumerId: {
              organisationId: string;
              promotionId: string;
              consumerId: string;
            };
          };
        }) => {
          const key = args.where.organisationId_promotionId_consumerId;
          const row = [...grants.values()].find(
            (g) =>
              g.organisationId === key.organisationId &&
              g.promotionId === key.promotionId &&
              g.consumerId === key.consumerId,
          );
          return Promise.resolve(
            row ? { ...row, consumer: {}, promotion: {}, qualifyingSalesOrder: {} } : null,
          );
        },
      ),
    },
  } as unknown as PrismaService;

  return { prisma, grants, accounts, ledgerEntries };
}

describe('RewardGrantRepository.createWithEarn', () => {
  const baseData = {
    organisationId: 'org-1',
    consumerId: 'consumer-1',
    promotionId: 'promo-1',
    qualifyingSalesOrderId: 'so-1',
    promotionNameSnapshot: 'First Order October',
    benefitTypeSnapshot: 'BONUS_POINTS' as const,
    pointsAwardedSnapshot: 200,
    freeProductIdSnapshot: null,
    freeProductQuantitySnapshot: null,
    conditionsSnapshot: [{ type: 'FIRST_QUALIFYING_ORDER' }],
  };

  it('creates a grant and atomically earns points into a new loyalty account', async () => {
    const { prisma, accounts, ledgerEntries } = makeFakePrisma();
    const repository = new RewardGrantRepository(prisma);

    const { grant, wasCreated } = await repository.createWithEarn(baseData);

    expect(wasCreated).toBe(true);
    expect(grant.id).toBeDefined();
    expect(accounts.get('consumer-1')?.balance).toBe(200);
    expect(ledgerEntries).toHaveLength(1);
    expect(ledgerEntries[0]).toMatchObject({ type: 'EARN', amount: 200, balanceAfter: 200 });
  });

  it('a second grant for the same consumer+promotion increments the SAME account rather than creating a second one', async () => {
    const { prisma, accounts } = makeFakePrisma();
    const repository = new RewardGrantRepository(prisma);

    await repository.createWithEarn(baseData);
    await repository.createWithEarn({
      ...baseData,
      promotionId: 'promo-2',
      promotionNameSnapshot: 'Weekend Bonus',
    });

    expect(accounts.size).toBe(1);
    expect(accounts.get('consumer-1')?.balance).toBe(400);
  });

  it('a duplicate grant attempt (same organisationId+promotionId+consumerId) resolves to the existing row, wasCreated=false, no second ledger entry', async () => {
    const { prisma, grants, ledgerEntries } = makeFakePrisma();
    const repository = new RewardGrantRepository(prisma);

    const first = await repository.createWithEarn(baseData);
    const second = await repository.createWithEarn(baseData);

    expect(second.wasCreated).toBe(false);
    expect(second.grant.id).toBe(first.grant.id);
    expect(grants.size).toBe(1);
    expect(ledgerEntries).toHaveLength(1);
  });

  it('a FREE_PRODUCT grant is created as PENDING_FULFILLMENT and never touches the loyalty ledger', async () => {
    const { prisma, accounts, ledgerEntries } = makeFakePrisma();
    const repository = new RewardGrantRepository(prisma);

    const { grant } = await repository.createWithEarn({
      ...baseData,
      benefitTypeSnapshot: 'FREE_PRODUCT',
      pointsAwardedSnapshot: null,
      freeProductIdSnapshot: 'product-1',
      freeProductQuantitySnapshot: 1,
    });

    expect(grant.status).toBe('PENDING_FULFILLMENT');
    expect(accounts.size).toBe(0);
    expect(ledgerEntries).toHaveLength(0);
  });
});
