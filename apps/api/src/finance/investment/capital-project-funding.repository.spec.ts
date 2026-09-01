import { CapitalProjectFundingRepository } from './capital-project-funding.repository';
import { PrismaService } from '../../prisma/prisma.service';

function makeRepository() {
  const rows = new Map<string, Record<string, unknown>>();
  let seq = 0;

  const tx = {
    capitalProjectFunding: {
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
          for (const row of rows.values()) {
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
        seq += 1;
        const id = `funding-${seq}`;
        const row = { id, ...data };
        rows.set(id, row);
        return row;
      }),
    },
  };

  const prisma = {
    $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb(tx)),
  } as unknown as PrismaService;

  return { repository: new CapitalProjectFundingRepository(prisma), rows };
}

const ORG = 'org-1';

function baseData(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    organisationId: ORG,
    capitalProjectId: 'project-1',
    fundingType: 'CASH',
    amount: 20_000_000,
    createdById: 'user-1',
    ...overrides,
  } as never;
}

describe('CapitalProjectFundingRepository.create', () => {
  it('creates a new funding row', async () => {
    const { repository, rows } = makeRepository();
    const result = await repository.create(baseData());
    expect(result.wasCreated).toBe(true);
    expect(rows.size).toBe(1);
  });

  it('is idempotent — a replayed idempotencyKey returns the original result, no duplicate row', async () => {
    const { repository, rows } = makeRepository();
    const input = baseData({ idempotencyKey: 'funding-key-1' });

    const first = await repository.create(input);
    const second = await repository.create(input);

    expect(first.wasCreated).toBe(true);
    expect(second.wasCreated).toBe(false);
    expect(second.capitalProjectFunding.id).toBe(first.capitalProjectFunding.id);
    expect(rows.size).toBe(1);
  });

  it('two funding rows with different idempotency keys are both created', async () => {
    const { repository, rows } = makeRepository();
    await repository.create(baseData({ idempotencyKey: 'key-cash' }));
    await repository.create(
      baseData({
        fundingType: 'DEBT',
        amount: 40_000_000,
        debtFacilityId: 'facility-1',
        idempotencyKey: 'key-debt',
      }),
    );
    expect(rows.size).toBe(2);
  });
});
