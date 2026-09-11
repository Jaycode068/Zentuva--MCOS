import {
  MaintenanceProcurementRepository,
  ProcurementRequirementNotFoundError,
  ProcurementRequirementStatusConflictError,
} from './maintenance-procurement.repository';
import { PrismaService } from '../prisma/prisma.service';

const ORG = 'org-1';
const OTHER_ORG = 'org-2';

function makeRepository(options?: { initialRequirement?: Record<string, unknown> }) {
  const requirements = new Map<string, Record<string, unknown>>();
  let seq = 0;

  if (options?.initialRequirement) {
    requirements.set(options.initialRequirement.id as string, options.initialRequirement);
  }

  const tx = {
    maintenanceProcurementRequirement: {
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
          for (const row of requirements.values()) {
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
      findFirst: jest.fn(async ({ where }: { where: { id: string; organisationId: string } }) => {
        const row = requirements.get(where.id);
        if (!row || row.organisationId !== where.organisationId) return null;
        return row;
      }),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        seq += 1;
        const row = { id: `req-${seq}`, status: 'IDENTIFIED', ...data };
        requirements.set(row.id, row);
        return row;
      }),
      update: jest.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = requirements.get(where.id);
          if (!row) throw new Error('not found');
          const updated = { ...row, ...data };
          requirements.set(where.id, updated);
          return updated;
        },
      ),
    },
  };

  const prisma = {
    $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb(tx)),
  } as unknown as PrismaService;

  return { repository: new MaintenanceProcurementRepository(prisma), requirements };
}

describe('MaintenanceProcurementRepository.create', () => {
  it('creates an IDENTIFIED requirement', async () => {
    const { repository } = makeRepository();
    const result = await repository.create({
      organisationId: ORG,
      workOrderId: 'wo-1',
      description: 'Replacement bearing',
      createdById: 'user-1',
    });
    expect(result.wasCreated).toBe(true);
    expect(result.requirement.status).toBe('IDENTIFIED');
  });

  it('idempotent replay: a duplicate idempotencyKey returns the original, no duplicate row', async () => {
    const { repository, requirements } = makeRepository();
    await repository.create({
      organisationId: ORG,
      workOrderId: 'wo-1',
      description: 'Replacement bearing',
      createdById: 'user-1',
      idempotencyKey: 'req-dup',
    });
    const second = await repository.create({
      organisationId: ORG,
      workOrderId: 'wo-1',
      description: 'Replacement bearing',
      createdById: 'user-1',
      idempotencyKey: 'req-dup',
    });
    expect(second.wasCreated).toBe(false);
    expect(requirements.size).toBe(1);
  });
});

describe('MaintenanceProcurementRepository.link', () => {
  it('attaches a purchaseOrderId and moves the requirement to LINKED', async () => {
    const { repository } = makeRepository({
      initialRequirement: { id: 'req-1', organisationId: ORG, status: 'IDENTIFIED' },
    });
    const result = await repository.link({
      organisationId: ORG,
      requirementId: 'req-1',
      purchaseOrderId: 'po-1',
    });
    expect(result.wasLinked).toBe(true);
    expect(result.requirement.status).toBe('LINKED');
    expect(result.requirement.purchaseOrderId).toBe('po-1');
  });

  it('is idempotent when re-linking the exact same purchase order', async () => {
    const { repository } = makeRepository({
      initialRequirement: {
        id: 'req-1',
        organisationId: ORG,
        status: 'LINKED',
        purchaseOrderId: 'po-1',
      },
    });
    const result = await repository.link({
      organisationId: ORG,
      requirementId: 'req-1',
      purchaseOrderId: 'po-1',
    });
    expect(result.wasLinked).toBe(false);
  });

  it('rejects re-linking to a different purchase order once already LINKED', async () => {
    const { repository } = makeRepository({
      initialRequirement: {
        id: 'req-1',
        organisationId: ORG,
        status: 'LINKED',
        purchaseOrderId: 'po-1',
      },
    });
    await expect(
      repository.link({ organisationId: ORG, requirementId: 'req-1', purchaseOrderId: 'po-2' }),
    ).rejects.toThrow(ProcurementRequirementStatusConflictError);
  });

  it('rejects linking a CANCELLED requirement', async () => {
    const { repository } = makeRepository({
      initialRequirement: { id: 'req-1', organisationId: ORG, status: 'CANCELLED' },
    });
    await expect(
      repository.link({ organisationId: ORG, requirementId: 'req-1', purchaseOrderId: 'po-1' }),
    ).rejects.toThrow(ProcurementRequirementStatusConflictError);
  });

  it('rejects a cross-tenant requirement id', async () => {
    const { repository } = makeRepository({
      initialRequirement: { id: 'req-1', organisationId: OTHER_ORG, status: 'IDENTIFIED' },
    });
    await expect(
      repository.link({ organisationId: ORG, requirementId: 'req-1', purchaseOrderId: 'po-1' }),
    ).rejects.toThrow(ProcurementRequirementNotFoundError);
  });
});

describe('MaintenanceProcurementRepository.cancel', () => {
  it('transitions IDENTIFIED to CANCELLED', async () => {
    const { repository } = makeRepository({
      initialRequirement: { id: 'req-1', organisationId: ORG, status: 'IDENTIFIED' },
    });
    const result = await repository.cancel(ORG, 'req-1');
    expect(result.requirement.status).toBe('CANCELLED');
  });

  it('is idempotent against an already-CANCELLED row', async () => {
    const { repository } = makeRepository({
      initialRequirement: { id: 'req-1', organisationId: ORG, status: 'CANCELLED' },
    });
    const result = await repository.cancel(ORG, 'req-1');
    expect(result.requirement.status).toBe('CANCELLED');
  });

  it('rejects cancelling an already-LINKED requirement', async () => {
    const { repository } = makeRepository({
      initialRequirement: { id: 'req-1', organisationId: ORG, status: 'LINKED' },
    });
    await expect(repository.cancel(ORG, 'req-1')).rejects.toThrow(
      ProcurementRequirementStatusConflictError,
    );
  });
});

describe('MaintenanceProcurementRepository.getApSummaryForPurchaseOrder', () => {
  it('computes amountOutstanding from recognizedAmount minus paid minus credited, never never touches SupplierInvoice/PurchaseOrder write methods', async () => {
    const aggregate = jest.fn(async () => ({
      _sum: {
        total: 1_050_000,
        recognizedAmount: 1_000_000,
        amountPaid: 400_000,
        amountCredited: 0,
      },
    }));
    const count = jest.fn(async () => 1);
    const prisma = {
      supplierInvoice: { aggregate, count },
    } as unknown as PrismaService;
    const repository = new MaintenanceProcurementRepository(prisma);

    const result = await repository.getApSummaryForPurchaseOrder(ORG, 'po-1');

    expect(result).toEqual({
      invoicedTotal: 1_050_000,
      recognizedAmount: 1_000_000,
      amountPaid: 400_000,
      amountOutstanding: 600_000,
      discrepancyCount: 1,
    });
    expect(aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organisationId: ORG, purchaseOrderId: 'po-1', status: { not: 'VOID' } },
      }),
    );
  });

  it('never returns a negative amountOutstanding when paid+credited exceeds recognized', async () => {
    const prisma = {
      supplierInvoice: {
        aggregate: jest.fn(async () => ({
          _sum: { total: 100, recognizedAmount: 100, amountPaid: 80, amountCredited: 30 },
        })),
        count: jest.fn(async () => 0),
      },
    } as unknown as PrismaService;
    const repository = new MaintenanceProcurementRepository(prisma);

    const result = await repository.getApSummaryForPurchaseOrder(ORG, 'po-1');
    expect(result.amountOutstanding).toBe(0);
  });
});
