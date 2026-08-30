import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AccountType, Budget, BudgetLineType, BudgetStatus } from '@prisma/client';

import { BudgetService } from './budget.service';

const ORG = 'org-1';

function makeBudget(overrides: Partial<Budget> = {}): Budget {
  return {
    id: 'budget-1',
    organisationId: ORG,
    budgetCode: 'BUD-2026-OPS',
    name: '2026 Operating Budget',
    description: null,
    fiscalYear: 2026,
    scenarioName: 'Base',
    version: 1,
    revisesBudgetId: null,
    cashflowScenarioId: null,
    startDate: new Date(2026, 0, 1),
    endDate: new Date(2026, 11, 31),
    currency: 'NGN',
    status: BudgetStatus.DRAFT,
    notes: null,
    idempotencyKey: null,
    createdById: 'user-1',
    approvedById: null,
    approvedAt: null,
    activatedAt: null,
    closedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeService(
  overrides: {
    budget?: Budget;
    accountType?: AccountType;
  } = {},
) {
  const budget = overrides.budget ?? makeBudget();

  const budgetRepository = {
    findById: jest.fn(async () => budget),
    create: jest.fn(async () => ({ budget, wasCreated: true })),
    update: jest.fn(async () => budget),
    approve: jest.fn(async () => ({ ...budget, status: BudgetStatus.APPROVED })),
    activate: jest.fn(async () => ({ ...budget, status: BudgetStatus.ACTIVE })),
    close: jest.fn(async () => ({ ...budget, status: BudgetStatus.CLOSED })),
    revise: jest.fn(async () => ({ ...budget, id: 'budget-2', version: 2 })),
  };
  const chartOfAccountRepository = {
    findById: jest.fn(async () => ({
      id: 'account-1',
      type: overrides.accountType ?? AccountType.REVENUE,
    })),
  };
  const organisationService = {
    getById: jest.fn(async () => ({ id: ORG, fiscalYearStart: 1 })),
  };
  const cashflowScenarioRepository = {
    findById: jest.fn(async () => null),
  };

  const service = new BudgetService(
    budgetRepository as any,
    chartOfAccountRepository as any,
    organisationService as any,
    cashflowScenarioRepository as any,
  );
  return { service, budgetRepository, chartOfAccountRepository };
}

describe('BudgetService.create', () => {
  it("derives startDate/endDate from the fiscal year and the organisation's own fiscalYearStart", async () => {
    const { service, budgetRepository } = makeService();
    (budgetRepository.create as jest.Mock).mockImplementation(async (data: any) => ({
      budget: { ...makeBudget(), ...data },
      wasCreated: true,
    }));

    await service.create(
      ORG,
      {
        budgetCode: 'BUD-2026-OPS',
        name: '2026 Operating Budget',
        fiscalYear: 2026,
        scenarioName: 'Base',
        currency: 'NGN',
      } as any,
      'user-1',
    );

    expect(budgetRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ startDate: new Date(2026, 0, 1), endDate: new Date(2026, 11, 31) }),
    );
  });
});

describe('BudgetService lifecycle guards', () => {
  it('approve() rejects a non-DRAFT budget', async () => {
    const { service } = makeService({ budget: makeBudget({ status: BudgetStatus.APPROVED }) });
    await expect(service.approve(ORG, 'budget-1', 'user-1')).rejects.toThrow(BadRequestException);
  });

  it('activate() rejects a non-APPROVED budget', async () => {
    const { service } = makeService({ budget: makeBudget({ status: BudgetStatus.DRAFT }) });
    await expect(service.activate(ORG, 'budget-1')).rejects.toThrow(BadRequestException);
  });

  it('close() rejects a non-ACTIVE budget', async () => {
    const { service } = makeService({ budget: makeBudget({ status: BudgetStatus.APPROVED }) });
    await expect(service.close(ORG, 'budget-1')).rejects.toThrow(BadRequestException);
  });

  it('revise() rejects a DRAFT budget (edit it directly instead)', async () => {
    const { service } = makeService({ budget: makeBudget({ status: BudgetStatus.DRAFT }) });
    await expect(service.revise(ORG, 'budget-1', 'user-1')).rejects.toThrow(BadRequestException);
  });

  it('revise() succeeds from ACTIVE', async () => {
    const { service } = makeService({ budget: makeBudget({ status: BudgetStatus.ACTIVE }) });
    const revision = await service.revise(ORG, 'budget-1', 'user-1');
    expect(revision.version).toBe(2);
  });

  it('update() rejects editing a non-DRAFT budget', async () => {
    const { service } = makeService({ budget: makeBudget({ status: BudgetStatus.ACTIVE }) });
    await expect(service.update(ORG, 'budget-1', { name: 'New name' } as any)).rejects.toThrow(
      BadRequestException,
    );
  });
});

describe('BudgetService.assertLineWritable', () => {
  it('rejects a REVENUE line with no chartOfAccountId', async () => {
    const { service } = makeService();
    await expect(
      service.assertLineWritable(ORG, 'budget-1', {
        lineType: BudgetLineType.REVENUE,
        periodMonth: new Date(2026, 0, 1),
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects an OPERATING_EXPENSE line pointed at a REVENUE-type account', async () => {
    const { service } = makeService({ accountType: AccountType.REVENUE });
    await expect(
      service.assertLineWritable(ORG, 'budget-1', {
        lineType: BudgetLineType.OPERATING_EXPENSE,
        chartOfAccountId: 'account-1',
        periodMonth: new Date(2026, 0, 1),
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('accepts a REVENUE line pointed at a REVENUE-type account', async () => {
    const { service } = makeService({ accountType: AccountType.REVENUE });
    await expect(
      service.assertLineWritable(ORG, 'budget-1', {
        lineType: BudgetLineType.REVENUE,
        chartOfAccountId: 'account-1',
        periodMonth: new Date(2026, 0, 1),
      }),
    ).resolves.toBeDefined();
  });

  it('allows a CAPEX line with no chartOfAccountId at all', async () => {
    const { service } = makeService();
    await expect(
      service.assertLineWritable(ORG, 'budget-1', {
        lineType: BudgetLineType.CAPEX,
        periodMonth: new Date(2026, 5, 1),
      }),
    ).resolves.toBeDefined();
  });

  it("rejects a periodMonth outside the budget's own fiscal year", async () => {
    const { service } = makeService();
    await expect(
      service.assertLineWritable(ORG, 'budget-1', {
        lineType: BudgetLineType.CAPEX,
        periodMonth: new Date(2027, 0, 1),
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects writing a line on a non-DRAFT budget', async () => {
    const { service } = makeService({ budget: makeBudget({ status: BudgetStatus.ACTIVE }) });
    await expect(
      service.assertLineWritable(ORG, 'budget-1', {
        lineType: BudgetLineType.CAPEX,
        periodMonth: new Date(2026, 5, 1),
      }),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('BudgetService tenant isolation', () => {
  it('getById throws NotFoundException when the repository finds nothing for this org', async () => {
    const { service, budgetRepository } = makeService();
    (budgetRepository.findById as jest.Mock).mockResolvedValueOnce(null);
    await expect(service.getById('org-2', 'budget-1')).rejects.toThrow(NotFoundException);
  });
});
