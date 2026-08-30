import { CashflowSettingsRepository } from './cashflow-settings.repository';
import { PrismaService } from '../../prisma/prisma.service';

function makeRepository() {
  const settingsByOrg = new Map<string, Record<string, unknown>>();
  const prisma = {
    cashflowSettings: {
      findUnique: jest.fn(
        async ({ where }: { where: { organisationId: string } }) =>
          settingsByOrg.get(where.organisationId) ?? null,
      ),
      upsert: jest.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: { organisationId: string };
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => {
          const existing = settingsByOrg.get(where.organisationId);
          if (existing) {
            Object.assign(existing, update);
            return existing;
          }
          const created = { id: 'settings-1', ...create };
          settingsByOrg.set(where.organisationId, created);
          return created;
        },
      ),
    },
  } as unknown as PrismaService;
  return { repository: new CashflowSettingsRepository(prisma), settingsByOrg };
}

const ORG = 'org-1';

describe('CashflowSettingsRepository', () => {
  it('returns null when no settings have ever been configured', async () => {
    const { repository } = makeRepository();
    expect(await repository.findByOrganisation(ORG)).toBeNull();
  });

  it('upsert creates a row on first call and updates it (not a duplicate) on the second', async () => {
    const { repository, settingsByOrg } = makeRepository();
    const first = await repository.upsert(ORG, { minimumCashReserve: 5_000_000 }, 'user-1');
    expect(first.minimumCashReserve).toBe(5_000_000);

    const second = await repository.upsert(ORG, { minimumCashReserve: 10_000_000 }, 'user-1');
    expect(second.minimumCashReserve).toBe(10_000_000);
    expect(settingsByOrg.size).toBe(1);
  });
});
