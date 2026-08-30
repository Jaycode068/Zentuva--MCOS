import { CashflowScenarioRepository } from './cashflow-scenario.repository';
import { PrismaService } from '../../prisma/prisma.service';

function makeFakeTx() {
  const scenarios = new Map<string, Record<string, unknown>>();
  let sequence = 0;

  const tx = {
    cashflowScenario: {
      findUnique: jest.fn(
        async ({
          where,
        }: {
          where: {
            organisationId_idempotencyKey?: { organisationId: string; idempotencyKey: string };
          };
        }) => {
          const key = where.organisationId_idempotencyKey;
          if (!key) return null;
          for (const scenario of scenarios.values()) {
            if (
              scenario.organisationId === key.organisationId &&
              scenario.idempotencyKey === key.idempotencyKey
            ) {
              return scenario;
            }
          }
          return null;
        },
      ),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        sequence += 1;
        const id = `scn-${sequence}`;
        const scenario = { id, ...data };
        scenarios.set(id, scenario);
        return scenario;
      }),
    },
  };

  return { tx, scenarios };
}

function makeRepository() {
  const fake = makeFakeTx();
  const prisma = {
    $transaction: jest.fn(async (callback: (tx: unknown) => unknown) => callback(fake.tx)),
    cashflowScenario: {
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string; organisationId: string };
          data: Record<string, unknown>;
        }) => {
          const scenario = fake.scenarios.get(where.id);
          if (!scenario || scenario.organisationId !== where.organisationId) return { count: 0 };
          Object.assign(scenario, data);
          return { count: 1 };
        },
      ),
      findUniqueOrThrow: jest.fn(async ({ where }: { where: { id: string } }) =>
        fake.scenarios.get(where.id)!,
      ),
    },
  } as unknown as PrismaService;
  return { repository: new CashflowScenarioRepository(prisma), ...fake };
}

const ORG = 'org-1';

const BASE_INPUT = {
  organisationId: ORG,
  name: 'Conservative',
  inflowDelayDays: 30,
  inflowMultiplier: 0.8,
  outflowDelayDays: 0,
  outflowMultiplier: 1,
  createdById: 'user-1',
};

describe('CashflowScenarioRepository.create', () => {
  it('creates a scenario', async () => {
    const { repository } = makeRepository();
    const result = await repository.create(BASE_INPUT);
    expect(result.wasCreated).toBe(true);
    expect(result.cashflowScenario.name).toBe('Conservative');
  });

  it('is idempotent — a replayed idempotencyKey returns the original result, not a duplicate', async () => {
    const { repository, scenarios } = makeRepository();
    const input = { ...BASE_INPUT, idempotencyKey: 'key-1' };
    const first = await repository.create(input);
    const second = await repository.create(input);
    expect(first.wasCreated).toBe(true);
    expect(second.wasCreated).toBe(false);
    expect(second.cashflowScenario.id).toBe(first.cashflowScenario.id);
    expect(scenarios.size).toBe(1);
  });
});

describe('CashflowScenarioRepository.deactivate', () => {
  it('is tenant-scoped', async () => {
    const { repository } = makeRepository();
    const { cashflowScenario } = await repository.create(BASE_INPUT);
    const crossTenant = await repository.deactivate('org-2', cashflowScenario.id, 'user-1');
    expect(crossTenant).toBeNull();
    const deactivated = await repository.deactivate(ORG, cashflowScenario.id, 'user-1');
    expect(deactivated?.status).toBe('INACTIVE');
  });
});
