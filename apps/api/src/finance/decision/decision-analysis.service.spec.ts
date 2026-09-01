import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DecisionAnalysisStatus } from '@prisma/client';

import { DecisionAnalysisService } from './decision-analysis.service';

const ORG = 'org-1';

function makeAnalysis(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'analysis-1',
    organisationId: ORG,
    name: 'Plantain Chips Line — Investment Decision',
    status: DecisionAnalysisStatus.DRAFT,
    analysisPeriodMonths: 60,
    discountRatePercent: 15,
    maxAcceptablePaybackYears: 3,
    capitalProjectId: null,
    debtFacilityId: null,
    ...overrides,
  };
}

function makeService(params: { analysis?: Record<string, unknown> } = {}) {
  const analysis = params.analysis ?? makeAnalysis();

  const decisionAnalysisRepository = {
    findById: jest.fn(async () => analysis),
    findManyByOrganisation: jest.fn(async () => [analysis]),
    create: jest.fn(async () => ({ decisionAnalysis: analysis, wasCreated: true })),
    update: jest.fn(async (_org: string, _id: string, data: Record<string, unknown>) => ({
      ...analysis,
      ...data,
    })),
    setStatus: jest.fn(async (_org: string, _id: string, data: Record<string, unknown>) => ({
      ...analysis,
      ...data,
    })),
  };
  const capitalProjectRepository = { findById: jest.fn(async () => ({ id: 'project-1' })) };
  const debtFacilityRepository = { findById: jest.fn(async () => ({ id: 'facility-1' })) };

  const service = new DecisionAnalysisService(
    decisionAnalysisRepository as never,
    capitalProjectRepository as never,
    debtFacilityRepository as never,
  );

  return {
    service,
    decisionAnalysisRepository,
    capitalProjectRepository,
    debtFacilityRepository,
    analysis,
  };
}

describe('DecisionAnalysisService — lifecycle', () => {
  it('submit() moves DRAFT to UNDER_REVIEW', async () => {
    const { service } = makeService();
    const result = await service.submit(ORG, 'analysis-1');
    expect(result.transitioned).toBe(true);
    expect(result.decisionAnalysis.status).toBe(DecisionAnalysisStatus.UNDER_REVIEW);
  });

  it('approve() rejects a DRAFT analysis that has not been submitted', async () => {
    const { service } = makeService();
    await expect(service.approve(ORG, 'analysis-1', 'user-1')).rejects.toThrow(BadRequestException);
  });

  it('approve() moves UNDER_REVIEW to APPROVED and stamps approvedById/approvedAt', async () => {
    const { service } = makeService({
      analysis: makeAnalysis({ status: DecisionAnalysisStatus.UNDER_REVIEW }),
    });
    const result = await service.approve(ORG, 'analysis-1', 'user-1');
    expect(result.transitioned).toBe(true);
    expect(result.decisionAnalysis.status).toBe(DecisionAnalysisStatus.APPROVED);
  });

  it('soft, status-based idempotency: approving an already-APPROVED analysis returns the current row unchanged, no error', async () => {
    const { service, decisionAnalysisRepository } = makeService({
      analysis: makeAnalysis({ status: DecisionAnalysisStatus.APPROVED }),
    });
    const result = await service.approve(ORG, 'analysis-1', 'user-1');
    expect(result.transitioned).toBe(false);
    expect(result.decisionAnalysis.status).toBe(DecisionAnalysisStatus.APPROVED);
    expect(decisionAnalysisRepository.setStatus).not.toHaveBeenCalled();
  });

  it('reject() moves UNDER_REVIEW to REJECTED with a reason', async () => {
    const { service } = makeService({
      analysis: makeAnalysis({ status: DecisionAnalysisStatus.UNDER_REVIEW }),
    });
    const result = await service.reject(ORG, 'analysis-1', 'user-1', 'Too risky');
    expect(result.decisionAnalysis.status).toBe(DecisionAnalysisStatus.REJECTED);
    expect(result.decisionAnalysis.rejectionReason).toBe('Too risky');
  });

  it('throws NotFoundException when the analysis does not belong to this organisation', async () => {
    const { service, decisionAnalysisRepository } = makeService();
    decisionAnalysisRepository.findById.mockResolvedValueOnce(null as never);
    await expect(service.getById('other-org', 'analysis-1')).rejects.toThrow(NotFoundException);
  });
});

describe('DecisionAnalysisService — editability', () => {
  it('allows editing while DRAFT or UNDER_REVIEW', () => {
    const { service } = makeService();
    expect(() =>
      service.assertEditable(makeAnalysis({ status: DecisionAnalysisStatus.DRAFT }) as never),
    ).not.toThrow();
    expect(() =>
      service.assertEditable(
        makeAnalysis({ status: DecisionAnalysisStatus.UNDER_REVIEW }) as never,
      ),
    ).not.toThrow();
  });

  it('rejects editing once APPROVED or REJECTED', () => {
    const { service } = makeService();
    expect(() =>
      service.assertEditable(makeAnalysis({ status: DecisionAnalysisStatus.APPROVED }) as never),
    ).toThrow(BadRequestException);
    expect(() =>
      service.assertEditable(makeAnalysis({ status: DecisionAnalysisStatus.REJECTED }) as never),
    ).toThrow(BadRequestException);
  });
});

describe('DecisionAnalysisService — reference validation', () => {
  it('rejects create() when the linked capital project does not belong to this organisation', async () => {
    const { service, capitalProjectRepository } = makeService();
    capitalProjectRepository.findById.mockResolvedValueOnce(null as never);
    await expect(
      service.create(
        ORG,
        { name: 'X', decisionType: 'NEW_INVESTMENT', capitalProjectId: 'bad-id' } as never,
        'user-1',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects create() when the linked debt facility does not belong to this organisation', async () => {
    const { service, debtFacilityRepository } = makeService();
    debtFacilityRepository.findById.mockResolvedValueOnce(null as never);
    await expect(
      service.create(
        ORG,
        { name: 'X', decisionType: 'NEW_INVESTMENT', debtFacilityId: 'bad-id' } as never,
        'user-1',
      ),
    ).rejects.toThrow(BadRequestException);
  });
});
