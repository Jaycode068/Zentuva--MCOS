import { BadRequestException } from '@nestjs/common';
import { CapitalRequirementStatus } from '@prisma/client';

import { CapitalRequirementService } from './capital-requirement.service';

const ORG = 'org-1';

function makeRequirement(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'cr-1',
    organisationId: ORG,
    title: 'Packaging Machine Expansion',
    requiredAmount: 100_000_000,
    budgetId: null,
    budgetLineId: null,
    status: CapitalRequirementStatus.DRAFT,
    ...overrides,
  };
}

function makeService(requirement = makeRequirement()) {
  const capitalRequirementRepository = {
    findById: jest.fn(async () => requirement),
    setStatus: jest.fn(async (_org: string, _id: string, data: Record<string, unknown>) => ({
      ...requirement,
      ...data,
    })),
    update: jest.fn(async () => requirement),
  };
  const budgetRepository = { findById: jest.fn(async () => ({ id: 'budget-1' })) };
  const budgetLineRepository = { findManyByBudget: jest.fn(async () => []) };
  const costCentreRepository = { findById: jest.fn(async () => null) };

  const service = new CapitalRequirementService(
    capitalRequirementRepository as never,
    budgetRepository as never,
    budgetLineRepository as never,
    costCentreRepository as never,
  );
  return { service, capitalRequirementRepository, budgetLineRepository };
}

describe('CapitalRequirementService lifecycle guards', () => {
  it('propose() rejects a non-DRAFT requirement', async () => {
    const { service } = makeService(makeRequirement({ status: CapitalRequirementStatus.PROPOSED }));
    await expect(service.propose(ORG, 'cr-1')).rejects.toThrow(BadRequestException);
  });

  it('approve() rejects a non-PROPOSED requirement', async () => {
    const { service } = makeService(makeRequirement({ status: CapitalRequirementStatus.DRAFT }));
    await expect(service.approve(ORG, 'cr-1', 'user-1')).rejects.toThrow(BadRequestException);
  });

  it('fund() rejects a non-APPROVED requirement', async () => {
    const { service } = makeService(makeRequirement({ status: CapitalRequirementStatus.PROPOSED }));
    await expect(service.fund(ORG, 'cr-1')).rejects.toThrow(BadRequestException);
  });

  it('complete() rejects a non-FUNDED requirement', async () => {
    const { service } = makeService(makeRequirement({ status: CapitalRequirementStatus.APPROVED }));
    await expect(service.complete(ORG, 'cr-1')).rejects.toThrow(BadRequestException);
  });

  it('cancel() rejects an already-completed requirement', async () => {
    const { service } = makeService(
      makeRequirement({ status: CapitalRequirementStatus.COMPLETED }),
    );
    await expect(service.cancel(ORG, 'cr-1')).rejects.toThrow(BadRequestException);
  });

  it('the full happy path — DRAFT → PROPOSED → APPROVED → FUNDED → COMPLETED — succeeds at each step', async () => {
    const { service } = makeService(makeRequirement({ status: CapitalRequirementStatus.DRAFT }));
    await expect(service.propose(ORG, 'cr-1')).resolves.toBeDefined();
    const { service: s2 } = makeService(
      makeRequirement({ status: CapitalRequirementStatus.PROPOSED }),
    );
    await expect(s2.approve(ORG, 'cr-1', 'user-1')).resolves.toBeDefined();
    const { service: s3 } = makeService(
      makeRequirement({ status: CapitalRequirementStatus.APPROVED }),
    );
    await expect(s3.fund(ORG, 'cr-1')).resolves.toBeDefined();
    const { service: s4 } = makeService(
      makeRequirement({ status: CapitalRequirementStatus.FUNDED }),
    );
    await expect(s4.complete(ORG, 'cr-1')).resolves.toBeDefined();
  });
});

describe('CapitalRequirementService.getBudgetCoverage', () => {
  it('returns null when no budget is referenced', async () => {
    const { service } = makeService(makeRequirement({ budgetId: null }));
    await expect(service.getBudgetCoverage(ORG, 'cr-1')).resolves.toBeNull();
  });

  it('computes coverage against a specific budget line when budgetLineId is set', async () => {
    const requirement = makeRequirement({
      budgetId: 'budget-1',
      budgetLineId: 'line-1',
      requiredAmount: 100_000_000,
    });
    const { service, budgetLineRepository } = makeService(requirement);
    (budgetLineRepository.findManyByBudget as jest.Mock).mockResolvedValue([
      { id: 'line-1', amount: 120_000_000, lineType: 'CAPEX' },
      { id: 'line-2', amount: 5_000_000, lineType: 'CAPEX' },
    ]);

    const coverage = await service.getBudgetCoverage(ORG, 'cr-1');
    expect(coverage?.budgetedAmount).toBe(120_000_000);
    expect(coverage?.coveragePercent).toBe(120);
  });

  it('sums every CAPEX line in the budget when only budgetId is set (no specific line)', async () => {
    const requirement = makeRequirement({
      budgetId: 'budget-1',
      budgetLineId: null,
      requiredAmount: 100_000_000,
    });
    const { service, budgetLineRepository } = makeService(requirement);
    (budgetLineRepository.findManyByBudget as jest.Mock).mockResolvedValue([
      { id: 'line-1', amount: 8_000_000, lineType: 'CAPEX' },
      { id: 'line-2', amount: 3_500_000, lineType: 'CAPEX' },
      { id: 'line-3', amount: 30_000_000, lineType: 'REVENUE' },
    ]);

    const coverage = await service.getBudgetCoverage(ORG, 'cr-1');
    expect(coverage?.budgetedAmount).toBe(11_500_000);
    expect(coverage?.coveragePercent).toBeCloseTo(11.5, 1);
  });

  it('never mutates the budget or its lines — read-only', async () => {
    const requirement = makeRequirement({ budgetId: 'budget-1', budgetLineId: 'line-1' });
    const { service, budgetLineRepository } = makeService(requirement);
    (budgetLineRepository.findManyByBudget as jest.Mock).mockResolvedValue([
      { id: 'line-1', amount: 50_000_000, lineType: 'CAPEX' },
    ]);
    await service.getBudgetCoverage(ORG, 'cr-1');
    expect(budgetLineRepository.findManyByBudget).toHaveBeenCalled();
    // No update/create/upsert method exists on the mocked repository at all —
    // any attempt to call one would throw "is not a function".
  });
});
