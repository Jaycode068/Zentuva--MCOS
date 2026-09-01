import { CapitalProjectCostLineRepository } from './capital-project-cost-line.repository';
import { PrismaService } from '../../prisma/prisma.service';

function makeRepository() {
  const rows = new Map<string, Record<string, unknown>>();
  let seq = 0;

  const prisma = {
    capitalProjectCostLine: {
      findMany: jest.fn(async ({ where }: { where: { capitalProjectId: string } }) =>
        [...rows.values()].filter((row) => row.capitalProjectId === where.capitalProjectId),
      ),
      findUnique: jest.fn(
        async ({ where }: { where: { id: string } }) => rows.get(where.id) ?? null,
      ),
      findUniqueOrThrow: jest.fn(async ({ where }: { where: { id: string } }) => {
        const row = rows.get(where.id);
        if (!row) throw new Error('not found');
        return row;
      }),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        seq += 1;
        const id = `cost-line-${seq}`;
        const row = { id, ...data };
        rows.set(id, row);
        return row;
      }),
      updateMany: jest.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = rows.get(where.id);
          if (!row) return { count: 0 };
          rows.set(where.id, { ...row, ...data });
          return { count: 1 };
        },
      ),
      deleteMany: jest.fn(async ({ where }: { where: { id: string } }) => {
        const existed = rows.delete(where.id);
        return { count: existed ? 1 : 0 };
      }),
    },
  } as unknown as PrismaService;

  return { repository: new CapitalProjectCostLineRepository(prisma), rows };
}

function baseData(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    capitalProjectId: 'project-1',
    description: 'Machine',
    plannedAmount: 45_000_000,
    plannedMonth: new Date('2026-10-01'),
    createdById: 'user-1',
    ...overrides,
  } as never;
}

describe('CapitalProjectCostLineRepository', () => {
  it('creates a cost line and lists it by project', async () => {
    const { repository } = makeRepository();
    await repository.create(baseData());
    const lines = await repository.findManyByProject('project-1');
    expect(lines).toHaveLength(1);
    expect(lines[0]!.plannedAmount).toBe(45_000_000);
  });

  it('removes a cost line', async () => {
    const { repository } = makeRepository();
    const created = await repository.create(baseData());
    const removed = await repository.remove(created.id);
    expect(removed).toBe(true);
    expect(await repository.findManyByProject('project-1')).toHaveLength(0);
  });

  it('removing a non-existent cost line returns false', async () => {
    const { repository } = makeRepository();
    expect(await repository.remove('missing')).toBe(false);
  });

  it('multiple independent cost lines never collide (no natural unique key)', async () => {
    const { repository } = makeRepository();
    await repository.create(baseData({ description: 'Machine', plannedAmount: 45_000_000 }));
    await repository.create(baseData({ description: 'Installation', plannedAmount: 5_000_000 }));
    const lines = await repository.findManyByProject('project-1');
    expect(lines).toHaveLength(2);
  });
});
