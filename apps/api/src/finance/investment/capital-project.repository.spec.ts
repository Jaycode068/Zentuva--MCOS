import { CapitalProjectStatus } from '@prisma/client';

import { CapitalProjectRepository } from './capital-project.repository';
import { PrismaService } from '../../prisma/prisma.service';

function makeRepository() {
  const projects = new Map<string, Record<string, unknown>>();
  const costLines = new Map<string, Record<string, unknown>>();
  let projectSeq = 0;

  const tx = {
    capitalProject: {
      findUnique: jest.fn(
        async ({
          where,
        }: {
          where: {
            organisationId_idempotencyKey?: { organisationId: string; idempotencyKey: string };
            organisationId_projectCode?: { organisationId: string; projectCode: string };
          };
        }) => {
          const keyLookup = where.organisationId_idempotencyKey;
          if (keyLookup) {
            for (const project of projects.values()) {
              if (
                project.organisationId === keyLookup.organisationId &&
                project.idempotencyKey === keyLookup.idempotencyKey
              ) {
                return project;
              }
            }
            return null;
          }
          const codeLookup = where.organisationId_projectCode;
          if (codeLookup) {
            for (const project of projects.values()) {
              if (
                project.organisationId === codeLookup.organisationId &&
                project.projectCode === codeLookup.projectCode
              ) {
                return project;
              }
            }
            return null;
          }
          return null;
        },
      ),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        projectSeq += 1;
        const id = `project-${projectSeq}`;
        const project = { id, status: CapitalProjectStatus.DRAFT, ...data };
        projects.set(id, project);
        return project;
      }),
    },
  };

  const prisma = {
    $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb(tx)),
    capitalProjectCostLine: {
      findMany: jest.fn(
        async ({
          where,
        }: {
          where: {
            purchaseOrderId: null;
            capitalProject: { organisationId: string; status: CapitalProjectStatus };
          };
        }) => {
          return [...costLines.values()]
            .filter((line) => line.purchaseOrderId === null)
            .filter((line) => {
              const project = projects.get(line.capitalProjectId as string);
              return (
                project?.organisationId === where.capitalProject.organisationId &&
                project?.status === where.capitalProject.status
              );
            })
            .map((line) => {
              const project = projects.get(line.capitalProjectId as string)!;
              return {
                ...line,
                capitalProject: { projectCode: project.projectCode, name: project.name },
              };
            });
        },
      ),
    },
  } as unknown as PrismaService;

  return { repository: new CapitalProjectRepository(prisma), projects, costLines };
}

const ORG = 'org-1';

function baseData(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    organisationId: ORG,
    name: 'Plantain Chips Production Line Expansion',
    category: 'PRODUCTION_EQUIPMENT',
    plannedStartDate: new Date('2026-10-01'),
    plannedCompletionDate: new Date('2027-01-31'),
    createdById: 'user-1',
    ...overrides,
  } as never;
}

describe('CapitalProjectRepository.create', () => {
  it('generates projectCode CAP-000001', async () => {
    const { repository } = makeRepository();
    const result = await repository.create(baseData());
    expect(result.wasCreated).toBe(true);
    expect(result.capitalProject.projectCode).toBe('CAP-000001');
  });

  it('generates the next sequential projectCode when one already exists', async () => {
    const { repository } = makeRepository();
    await repository.create(baseData());
    const second = await repository.create(baseData({ idempotencyKey: 'second' }));
    expect(second.capitalProject.projectCode).toBe('CAP-000002');
  });

  it('is idempotent — a replayed idempotencyKey returns the original result, no duplicate project', async () => {
    const { repository, projects } = makeRepository();
    const input = baseData({ idempotencyKey: 'project-key-1' });

    const first = await repository.create(input);
    const second = await repository.create(input);

    expect(first.wasCreated).toBe(true);
    expect(second.wasCreated).toBe(false);
    expect(second.capitalProject.id).toBe(first.capitalProject.id);
    expect(projects.size).toBe(1);
  });
});

describe('CapitalProjectRepository.findPlannedCostLinesForForecast', () => {
  it('only returns cost lines for ACTIVE projects with no linked Purchase Order', async () => {
    const { repository, projects, costLines } = makeRepository();
    projects.set('project-active', {
      id: 'project-active',
      organisationId: ORG,
      status: CapitalProjectStatus.ACTIVE,
      projectCode: 'CAP-000001',
      name: 'Active Project',
    });
    projects.set('project-approved', {
      id: 'project-approved',
      organisationId: ORG,
      status: CapitalProjectStatus.APPROVED,
      projectCode: 'CAP-000002',
      name: 'Approved Project',
    });
    costLines.set('line-1', {
      id: 'line-1',
      capitalProjectId: 'project-active',
      description: 'Machine',
      plannedAmount: 45_000_000,
      plannedMonth: new Date('2026-10-01'),
      purchaseOrderId: null,
    });
    costLines.set('line-2', {
      id: 'line-2',
      capitalProjectId: 'project-active',
      description: 'Installation (already a real PO)',
      plannedAmount: 5_000_000,
      plannedMonth: new Date('2026-11-01'),
      purchaseOrderId: 'po-1',
    });
    costLines.set('line-3', {
      id: 'line-3',
      capitalProjectId: 'project-approved',
      description: 'Not yet active',
      plannedAmount: 10_000_000,
      plannedMonth: new Date('2026-10-01'),
      purchaseOrderId: null,
    });

    const rows = await repository.findPlannedCostLinesForForecast(ORG);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.description).toBe('Machine');
    expect(rows[0]!.amount).toBe(45_000_000);
  });
});
