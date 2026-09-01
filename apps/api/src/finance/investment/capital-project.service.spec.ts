import { BadRequestException } from '@nestjs/common';
import { CapitalProjectStatus } from '@prisma/client';

import { CapitalProjectService } from './capital-project.service';

const ORG = 'org-1';

function makeProject(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'project-1',
    organisationId: ORG,
    projectCode: 'CAP-000001',
    name: 'Plantain Chips Production Line Expansion',
    status: CapitalProjectStatus.DRAFT,
    budgetId: null,
    budgetLineId: null,
    ...overrides,
  };
}

function makeService(
  params: {
    project?: Record<string, unknown>;
    costLines?: Record<string, unknown>[];
    fundingRows?: Record<string, unknown>[];
    purchaseOrders?: Record<string, unknown>[];
    apByPurchaseOrder?: Record<string, { total: number; recognizedAmount: number }>;
  } = {},
) {
  const project = params.project ?? makeProject();
  const costLines = params.costLines ?? [];
  const fundingRows = params.fundingRows ?? [];
  const purchaseOrders = params.purchaseOrders ?? [];
  const apByPurchaseOrder = params.apByPurchaseOrder ?? {};

  const capitalProjectRepository = {
    findById: jest.fn(async () => project),
    create: jest.fn(async () => ({ capitalProject: project, wasCreated: true })),
    update: jest.fn(async (_org: string, _id: string, data: Record<string, unknown>) => ({
      ...project,
      ...data,
    })),
    setStatus: jest.fn(async (_org: string, _id: string, data: Record<string, unknown>) => ({
      ...project,
      ...data,
    })),
  };
  const costLineRepository = {
    findManyByProject: jest.fn(async () => costLines),
    create: jest.fn(async (data: Record<string, unknown>) => ({ id: 'cost-line-new', ...data })),
    remove: jest.fn(async () => true),
  };
  const fundingRepository = {
    findManyByProject: jest.fn(async () => fundingRows),
    create: jest.fn(async (data: Record<string, unknown>) => ({
      capitalProjectFunding: { id: 'funding-new', ...data },
      wasCreated: true,
    })),
    remove: jest.fn(async () => true),
  };
  const budgetRepository = { findById: jest.fn(async () => ({ id: 'budget-1' })) };
  const budgetLineRepository = { findManyByBudget: jest.fn(async () => []) };
  const costCentreRepository = { findById: jest.fn(async () => ({ id: 'cc-1' })) };
  const capitalRequirementRepository = { findById: jest.fn(async () => ({ id: 'cr-1' })) };
  const debtFacilityRepository = { findById: jest.fn(async () => ({ id: 'facility-1' })) };
  const cashAccountRepository = { findById: jest.fn(async () => ({ id: 'cash-1' })) };
  const chartOfAccountRepository = { findById: jest.fn(async () => ({ id: 'coa-1' })) };
  const purchaseOrderRepository = {
    findById: jest.fn(
      async (_org: string, id: string) => purchaseOrders.find((po) => po.id === id) ?? null,
    ),
  };
  const supplierInvoiceRepository = {
    getApByPurchaseOrder: jest.fn(async (_org: string, purchaseOrderId: string) => ({
      aggregate: {
        _sum: {
          total: apByPurchaseOrder[purchaseOrderId]?.total ?? 0,
          recognizedAmount: apByPurchaseOrder[purchaseOrderId]?.recognizedAmount ?? 0,
        },
      },
      discrepancyCount: 0,
    })),
  };

  const service = new CapitalProjectService(
    capitalProjectRepository as never,
    costLineRepository as never,
    fundingRepository as never,
    budgetRepository as never,
    budgetLineRepository as never,
    costCentreRepository as never,
    capitalRequirementRepository as never,
    debtFacilityRepository as never,
    cashAccountRepository as never,
    chartOfAccountRepository as never,
    purchaseOrderRepository as never,
    supplierInvoiceRepository as never,
  );

  return {
    service,
    capitalProjectRepository,
    costLineRepository,
    fundingRepository,
    purchaseOrderRepository,
    supplierInvoiceRepository,
  };
}

describe('CapitalProjectService lifecycle transitions', () => {
  it('submit() rejects a non-DRAFT project', async () => {
    const { service } = makeService({
      project: makeProject({ status: CapitalProjectStatus.APPROVED }),
    });
    await expect(service.submit(ORG, 'project-1')).rejects.toThrow(BadRequestException);
  });

  it('approve() rejects a project not UNDER_REVIEW', async () => {
    const { service } = makeService({
      project: makeProject({ status: CapitalProjectStatus.DRAFT }),
    });
    await expect(service.approve(ORG, 'project-1', 'user-1')).rejects.toThrow(BadRequestException);
  });

  it('the full happy path — DRAFT -> PROPOSED -> UNDER_REVIEW -> APPROVED -> ACTIVE -> COMPLETED — succeeds at each step', async () => {
    const { service: s1 } = makeService({
      project: makeProject({ status: CapitalProjectStatus.DRAFT }),
    });
    await expect(s1.submit(ORG, 'project-1')).resolves.toBeDefined();

    const { service: s2 } = makeService({
      project: makeProject({ status: CapitalProjectStatus.PROPOSED }),
    });
    await expect(s2.startReview(ORG, 'project-1')).resolves.toBeDefined();

    const { service: s3 } = makeService({
      project: makeProject({ status: CapitalProjectStatus.UNDER_REVIEW }),
    });
    await expect(s3.approve(ORG, 'project-1', 'user-1')).resolves.toBeDefined();

    const { service: s4 } = makeService({
      project: makeProject({ status: CapitalProjectStatus.APPROVED }),
    });
    const activated = await s4.activate(ORG, 'project-1');
    expect(activated.transitioned).toBe(true);
    expect(activated.capitalProject.actualStartDate).toBeInstanceOf(Date);

    const { service: s5 } = makeService({
      project: makeProject({ status: CapitalProjectStatus.ACTIVE }),
    });
    const completed = await s5.complete(ORG, 'project-1');
    expect(completed.transitioned).toBe(true);
    expect(completed.capitalProject.actualCompletionDate).toBeInstanceOf(Date);
  });

  it('reject() sends an UNDER_REVIEW project back to DRAFT', async () => {
    const { service } = makeService({
      project: makeProject({ status: CapitalProjectStatus.UNDER_REVIEW }),
    });
    const result = await service.reject(ORG, 'project-1');
    expect(result.capitalProject.status).toBe(CapitalProjectStatus.DRAFT);
  });

  it('cancel() is rejected directly from ACTIVE — an active project must be placed ON_HOLD first', async () => {
    const { service } = makeService({
      project: makeProject({ status: CapitalProjectStatus.ACTIVE }),
    });
    await expect(service.cancel(ORG, 'project-1')).rejects.toThrow(BadRequestException);
  });

  it('cancel() succeeds from ON_HOLD', async () => {
    const { service } = makeService({
      project: makeProject({ status: CapitalProjectStatus.ON_HOLD }),
    });
    await expect(service.cancel(ORG, 'project-1')).resolves.toBeDefined();
  });

  it('a repeated approve() on an already-APPROVED project is soft-idempotent — returns the current row, no error, transitioned: false', async () => {
    const { service, capitalProjectRepository } = makeService({
      project: makeProject({ status: CapitalProjectStatus.APPROVED }),
    });
    const result = await service.approve(ORG, 'project-1', 'user-1');
    expect(result.transitioned).toBe(false);
    expect(result.capitalProject.status).toBe(CapitalProjectStatus.APPROVED);
    expect(capitalProjectRepository.setStatus).not.toHaveBeenCalled();
  });

  it('update() rejects editing a non-DRAFT project directly', async () => {
    const { service } = makeService({
      project: makeProject({ status: CapitalProjectStatus.ACTIVE }),
    });
    await expect(service.update(ORG, 'project-1', { name: 'New name' })).rejects.toThrow(
      BadRequestException,
    );
  });
});

describe('CapitalProjectService cost lines and funding editability', () => {
  it('addCostLine() rejects when the project is not DRAFT', async () => {
    const { service } = makeService({
      project: makeProject({ status: CapitalProjectStatus.APPROVED }),
    });
    await expect(
      service.addCostLine(
        ORG,
        'project-1',
        { description: 'Machine', plannedAmount: 45_000_000, plannedMonth: new Date() },
        'user-1',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('addFunding() succeeds while ACTIVE — funding stays editable past DRAFT', async () => {
    const { service } = makeService({
      project: makeProject({ status: CapitalProjectStatus.ACTIVE }),
    });
    await expect(
      service.addFunding(ORG, 'project-1', { fundingType: 'CASH', amount: 20_000_000 }, 'user-1'),
    ).resolves.toBeDefined();
  });

  it('addFunding() rejects once the project is COMPLETED', async () => {
    const { service } = makeService({
      project: makeProject({ status: CapitalProjectStatus.COMPLETED }),
    });
    await expect(
      service.addFunding(ORG, 'project-1', { fundingType: 'CASH', amount: 20_000_000 }, 'user-1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('addFunding() rejects a DEBT funding row with no debtFacilityId', async () => {
    const { service } = makeService();
    await expect(
      service.addFunding(ORG, 'project-1', { fundingType: 'DEBT', amount: 40_000_000 }, 'user-1'),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('CapitalProjectService.getFinancials (via getById/getSpending)', () => {
  it('server-computes plannedCost as the sum of cost lines — never a client-supplied total', async () => {
    const { service } = makeService({
      costLines: [
        { plannedAmount: 45_000_000, purchaseOrderId: null },
        { plannedAmount: 5_000_000, purchaseOrderId: null },
        { plannedAmount: 4_000_000, purchaseOrderId: null },
        { plannedAmount: 1_000_000, purchaseOrderId: null },
        { plannedAmount: 5_000_000, purchaseOrderId: null },
      ],
    });
    const project = await service.getById(ORG, 'project-1');
    expect(project.financials.plannedCost).toBe(60_000_000);
  });

  it('computes FULLY_FUNDED / UNDERFUNDED / OVERFUNDED correctly', async () => {
    const costLines = [{ plannedAmount: 60_000_000, purchaseOrderId: null }];

    const { service: fully } = makeService({
      costLines,
      fundingRows: [{ amount: 40_000_000 }, { amount: 20_000_000 }],
    });
    expect((await fully.getSpending(ORG, 'project-1')).fundingStatus).toBe('FULLY_FUNDED');
    expect((await fully.getSpending(ORG, 'project-1')).fundingGap).toBe(0);

    const { service: under } = makeService({
      costLines,
      fundingRows: [{ amount: 40_000_000 }],
    });
    const underResult = await under.getSpending(ORG, 'project-1');
    expect(underResult.fundingStatus).toBe('UNDERFUNDED');
    expect(underResult.fundingGap).toBe(20_000_000);

    const { service: over } = makeService({
      costLines,
      fundingRows: [{ amount: 70_000_000 }],
    });
    const overResult = await over.getSpending(ORG, 'project-1');
    expect(overResult.fundingStatus).toBe('OVERFUNDED');
    expect(overResult.fundingGap).toBe(0);
  });

  it('a cost line with no linked Purchase Order shows ₦0 committed/actual', async () => {
    const { service } = makeService({
      costLines: [{ plannedAmount: 1_000_000, purchaseOrderId: null }],
    });
    const result = await service.getSpending(ORG, 'project-1');
    expect(result.committedCost).toBe(0);
    expect(result.actualCost).toBe(0);
    expect(result.remainingCost).toBe(1_000_000);
  });

  it('committed/actual cost derive from the linked Purchase Order and its AP recognition, never a stored figure', async () => {
    const { service, purchaseOrderRepository, supplierInvoiceRepository } = makeService({
      costLines: [{ plannedAmount: 45_000_000, purchaseOrderId: 'po-1' }],
      purchaseOrders: [{ id: 'po-1', status: 'APPROVED', total: 45_000_000 }],
      apByPurchaseOrder: { 'po-1': { total: 20_000_000, recognizedAmount: 20_000_000 } },
    });
    const result = await service.getSpending(ORG, 'project-1');
    expect(purchaseOrderRepository.findById).toHaveBeenCalledWith(ORG, 'po-1');
    expect(supplierInvoiceRepository.getApByPurchaseOrder).toHaveBeenCalledWith(ORG, 'po-1');
    expect(result.committedCost).toBe(45_000_000);
    expect(result.actualCost).toBe(20_000_000);
    expect(result.remainingCost).toBe(0);
  });

  it('a CANCELLED linked Purchase Order contributes nothing to Committed Cost', async () => {
    const { service } = makeService({
      costLines: [{ plannedAmount: 45_000_000, purchaseOrderId: 'po-1' }],
      purchaseOrders: [{ id: 'po-1', status: 'CANCELLED', total: 45_000_000 }],
    });
    const result = await service.getSpending(ORG, 'project-1');
    expect(result.committedCost).toBe(0);
  });
});

describe('CapitalProjectService.getBudgetAllocation', () => {
  it('returns null when no budget is referenced', async () => {
    const { service } = makeService({ project: makeProject({ budgetId: null }) });
    await expect(service.getBudgetAllocation(ORG, 'project-1')).resolves.toBeNull();
  });
});
