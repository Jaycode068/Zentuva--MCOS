import { PromotionRepository } from './promotion.repository';

/**
 * Sprint 40 — a simple direct jest-mock map-backed fixture, the same convention
 * `collection-point-fulfillment.repository.spec.ts` already establishes for testing a
 * conditional-`updateMany` status transition in isolation.
 */
function makeSimplePrisma() {
  const promotions = new Map<string, Record<string, unknown>>();
  const conditions = new Map<string, Record<string, unknown>>();
  const benefits = new Map<string, Record<string, unknown>>();
  let seq = 0;

  const txLike = {
    promotionCondition: {
      deleteMany: jest.fn((args: { where: { promotionId: string } }) => {
        let count = 0;
        for (const [key, row] of conditions) {
          if (row.promotionId === args.where.promotionId) {
            conditions.delete(key);
            count += 1;
          }
        }
        return Promise.resolve({ count });
      }),
      createMany: jest.fn((args: { data: Record<string, unknown>[] }) => {
        for (const row of args.data) {
          seq += 1;
          conditions.set(`cond-${seq}`, { id: `cond-${seq}`, ...row });
        }
        return Promise.resolve({ count: args.data.length });
      }),
    },
    promotionBenefit: {
      deleteMany: jest.fn((args: { where: { promotionId: string } }) => {
        let count = 0;
        for (const [key, row] of benefits) {
          if (row.promotionId === args.where.promotionId) {
            benefits.delete(key);
            count += 1;
          }
        }
        return Promise.resolve({ count });
      }),
      createMany: jest.fn((args: { data: Record<string, unknown>[] }) => {
        for (const row of args.data) {
          seq += 1;
          benefits.set(`ben-${seq}`, { id: `ben-${seq}`, ...row });
        }
        return Promise.resolve({ count: args.data.length });
      }),
    },
    promotion: {
      findUniqueOrThrow: jest.fn((args: { where: { id: string } }) => {
        const row = promotions.get(args.where.id);
        if (!row) throw new Error('not found');
        return Promise.resolve({
          ...row,
          conditions: [...conditions.values()].filter((c) => c.promotionId === args.where.id),
          benefits: [...benefits.values()].filter((b) => b.promotionId === args.where.id),
        });
      }),
    },
  };

  const prisma = {
    $transaction: jest.fn((fn: (tx: typeof txLike) => Promise<unknown>) => fn(txLike)),
    promotion: {
      create: jest.fn((args: { data: Record<string, unknown> }) => {
        seq += 1;
        const id = `promo-${seq}`;
        const row = { id, status: 'DRAFT', ...args.data };
        promotions.set(id, row);
        return Promise.resolve({ ...row, conditions: [], benefits: [] });
      }),
      findFirst: jest.fn((args: { where: Record<string, unknown> }) => {
        const match = [...promotions.values()].find((row) =>
          Object.entries(args.where).every(([key, value]) => row[key] === value),
        );
        return Promise.resolve(
          match
            ? {
                ...match,
                conditions: [...conditions.values()].filter((c) => c.promotionId === match.id),
                benefits: [...benefits.values()].filter((b) => b.promotionId === match.id),
              }
            : null,
        );
      }),
      updateMany: jest.fn(
        (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          const statusFilter = args.where.status as { in: string[] } | undefined;
          let count = 0;
          for (const row of promotions.values()) {
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
    },
  };

  return { prisma, promotions, conditions, benefits };
}

describe('PromotionRepository', () => {
  function makeRepository() {
    const { prisma, promotions, conditions, benefits } = makeSimplePrisma();
    const repository = new PromotionRepository(prisma as never);
    return { repository, promotions, conditions, benefits };
  }

  it('creates a promotion with nested conditions and benefits', async () => {
    const { repository } = makeRepository();
    const created = await repository.create({
      organisationId: 'org-1',
      name: 'First Order October',
      startsAt: new Date('2026-10-01'),
      endsAt: new Date('2026-10-31'),
      conditions: [{ type: 'MINIMUM_ORDER_VALUE', minOrderValue: 5000 }],
      benefits: [{ type: 'BONUS_POINTS', pointsValue: 200 }],
    });

    expect(created.id).toBeDefined();
  });

  describe('updateStatus', () => {
    it('transitions DRAFT -> ACTIVE when the current status matches fromStatuses', async () => {
      const { repository } = makeRepository();
      const created = await repository.create({
        organisationId: 'org-1',
        name: 'Test',
        startsAt: new Date(),
        endsAt: new Date(),
        conditions: [],
        benefits: [],
      });

      const updated = await repository.updateStatus('org-1', created.id, ['DRAFT'], {
        status: 'ACTIVE',
      });
      expect(updated?.status).toBe('ACTIVE');
    });

    it('returns null (no-op) when the current status does not match fromStatuses', async () => {
      const { repository } = makeRepository();
      const created = await repository.create({
        organisationId: 'org-1',
        name: 'Test',
        startsAt: new Date(),
        endsAt: new Date(),
        conditions: [],
        benefits: [],
      });

      const result = await repository.updateStatus('org-1', created.id, ['ACTIVE'], {
        status: 'PAUSED',
      });
      expect(result).toBeNull();
    });

    it('returns null for a cross-tenant id, never mutating another tenant row', async () => {
      const { repository } = makeRepository();
      const created = await repository.create({
        organisationId: 'org-1',
        name: 'Test',
        startsAt: new Date(),
        endsAt: new Date(),
        conditions: [],
        benefits: [],
      });

      const result = await repository.updateStatus('org-2', created.id, ['DRAFT'], {
        status: 'ACTIVE',
      });
      expect(result).toBeNull();
    });
  });

  describe('replaceConditionsAndBenefits', () => {
    it('deletes the old conditions/benefits and creates the new ones atomically', async () => {
      const { repository } = makeRepository();
      const created = await repository.create({
        organisationId: 'org-1',
        name: 'Test',
        startsAt: new Date(),
        endsAt: new Date(),
        conditions: [{ type: 'FIRST_QUALIFYING_ORDER' }],
        benefits: [{ type: 'BONUS_POINTS', pointsValue: 100 }],
      });

      const updated = await repository.replaceConditionsAndBenefits(
        'org-1',
        created.id,
        [{ type: 'MINIMUM_ORDER_VALUE', minOrderValue: 7500 }],
        [{ type: 'BONUS_POINTS', pointsValue: 300 }],
      );

      expect(updated.conditions).toHaveLength(1);
      expect(updated.conditions[0]).toMatchObject({
        type: 'MINIMUM_ORDER_VALUE',
        minOrderValue: 7500,
      });
      expect(updated.benefits[0]).toMatchObject({ pointsValue: 300 });
    });
  });
});
