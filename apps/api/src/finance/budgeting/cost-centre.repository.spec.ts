import { CostCentreStatus, Prisma } from '@prisma/client';

import { CostCentreRepository } from './cost-centre.repository';
import { PrismaService } from '../../prisma/prisma.service';

function makeRepository() {
  const centres = new Map<string, Record<string, unknown>>();
  let sequence = 0;

  const prisma = {
    costCentre: {
      findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        for (const centre of centres.values()) {
          if (Object.entries(where).every(([key, value]) => centre[key] === value)) return centre;
        }
        return null;
      }),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        sequence += 1;
        const id = `cc-${sequence}`;
        const existing = [...centres.values()].find(
          (centre) => centre.organisationId === data.organisationId && centre.code === data.code,
        );
        if (existing) {
          const error = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
          throw new Prisma.PrismaClientKnownRequestError(error.message, {
            code: 'P2002',
            clientVersion: '5.0.0',
          });
        }
        const centre = { id, status: CostCentreStatus.ACTIVE, ...data };
        centres.set(id, centre);
        return centre;
      }),
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string; organisationId: string };
          data: Record<string, unknown>;
        }) => {
          const centre = centres.get(where.id);
          if (!centre || centre.organisationId !== where.organisationId) return { count: 0 };
          Object.assign(centre, data);
          return { count: 1 };
        },
      ),
      findUniqueOrThrow: jest.fn(async ({ where }: { where: { id: string } }) =>
        centres.get(where.id)!,
      ),
    },
  } as unknown as PrismaService;

  return { repository: new CostCentreRepository(prisma), centres };
}

const ORG = 'org-1';

describe('CostCentreRepository.create', () => {
  it('creates a new cost centre', async () => {
    const { repository } = makeRepository();
    const result = await repository.create({
      organisationId: ORG,
      code: 'PROD',
      name: 'Production',
      createdById: 'user-1',
    });
    expect(result.wasCreated).toBe(true);
    expect(result.costCentre.code).toBe('PROD');
  });

  it('a duplicate code for the same organisation returns the existing row instead of erroring', async () => {
    const { repository, centres } = makeRepository();
    const first = await repository.create({
      organisationId: ORG,
      code: 'PROD',
      name: 'Production',
      createdById: 'user-1',
    });
    const second = await repository.create({
      organisationId: ORG,
      code: 'PROD',
      name: 'Production (renamed attempt)',
      createdById: 'user-2',
    });
    expect(second.wasCreated).toBe(false);
    expect(second.costCentre.id).toBe(first.costCentre.id);
    expect(centres.size).toBe(1);
  });
});

describe('CostCentreRepository.deactivate/activate', () => {
  it('flips status and is tenant-scoped', async () => {
    const { repository } = makeRepository();
    const { costCentre } = await repository.create({
      organisationId: ORG,
      code: 'SALES',
      name: 'Sales',
      createdById: 'user-1',
    });

    const deactivated = await repository.deactivate(ORG, costCentre.id);
    expect(deactivated?.status).toBe('INACTIVE');

    const crossTenant = await repository.deactivate('org-2', costCentre.id);
    expect(crossTenant).toBeNull();

    const activated = await repository.activate(ORG, costCentre.id);
    expect(activated?.status).toBe('ACTIVE');
  });
});
