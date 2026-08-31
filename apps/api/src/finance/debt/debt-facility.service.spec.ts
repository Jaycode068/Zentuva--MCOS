import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AccountType, DebtFacilityStatus } from '@prisma/client';

import { DebtFacilityService } from './debt-facility.service';

const ORG = 'org-1';

function makeFacility(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'facility-1',
    organisationId: ORG,
    status: DebtFacilityStatus.PROPOSED,
    ...overrides,
  };
}

function makeService(
  params: {
    facility?: Record<string, unknown>;
    accountType?: AccountType;
    isSystemAccount?: boolean;
    lenderExists?: boolean;
  } = {},
) {
  const facility = params.facility ?? makeFacility();
  const debtFacilityRepository = {
    findById: jest.fn(async () => facility),
    update: jest.fn(async (_org: string, _id: string, data: Record<string, unknown>) => ({
      ...facility,
      ...data,
    })),
    create: jest.fn(async () => ({ debtFacility: facility, wasCreated: true })),
  };
  const lenderRepository = {
    findById: jest.fn(async () => (params.lenderExists === false ? null : { id: 'lender-1' })),
  };
  const chartOfAccountRepository = {
    findById: jest.fn(async () => ({
      id: 'account-1',
      type: params.accountType ?? AccountType.LIABILITY,
      isSystemAccount: params.isSystemAccount ?? false,
    })),
  };
  const capitalRequirementRepository = { findById: jest.fn(async () => null) };
  const prisma = {};

  const service = new DebtFacilityService(
    debtFacilityRepository as never,
    lenderRepository as never,
    chartOfAccountRepository as never,
    capitalRequirementRepository as never,
    prisma as never,
  );
  return { service, debtFacilityRepository, chartOfAccountRepository };
}

const BASE_INPUT = {
  lenderId: 'lender-1',
  name: 'Bank Equipment Loan',
  debtType: 'TERM_LOAN' as const,
  principalAmount: 60_000_000,
  currency: 'NGN',
  interestRatePercent: 20,
  repaymentMethod: 'AMORTISING' as const,
  repaymentFrequency: 'MONTHLY' as const,
  startDate: new Date(2026, 0, 1),
  tenorMonths: 24,
  graceMonths: 0,
  liabilityAccountId: 'account-liability',
  interestExpenseAccountId: 'account-interest',
};

describe('DebtFacilityService.create — account eligibility (Path B, decision #3)', () => {
  it('rejects a liabilityAccountId that does not resolve to a LIABILITY-type account', async () => {
    const { service } = makeService({ accountType: AccountType.EXPENSE });
    await expect(service.create(ORG, BASE_INPUT, 'user-1')).rejects.toThrow(BadRequestException);
  });

  it('rejects a system account', async () => {
    const { service } = makeService({ isSystemAccount: true });
    await expect(service.create(ORG, BASE_INPUT, 'user-1')).rejects.toThrow(BadRequestException);
  });

  it('rejects when the lender does not exist', async () => {
    const { service } = makeService({ lenderExists: false });
    await expect(service.create(ORG, BASE_INPUT, 'user-1')).rejects.toThrow(NotFoundException);
  });
});

describe('DebtFacilityService lifecycle guards', () => {
  it('approve() rejects a non-PROPOSED facility', async () => {
    const { service } = makeService({
      facility: makeFacility({ status: DebtFacilityStatus.ACTIVE }),
    });
    await expect(service.approve(ORG, 'facility-1', 'user-1')).rejects.toThrow(BadRequestException);
  });

  it('cancel() rejects a facility that has already been drawn (ACTIVE)', async () => {
    const { service } = makeService({
      facility: makeFacility({ status: DebtFacilityStatus.ACTIVE }),
    });
    await expect(service.cancel(ORG, 'facility-1')).rejects.toThrow(BadRequestException);
  });

  it('cancel() succeeds from PROPOSED or APPROVED', async () => {
    const { service } = makeService({
      facility: makeFacility({ status: DebtFacilityStatus.APPROVED }),
    });
    await expect(service.cancel(ORG, 'facility-1')).resolves.toBeDefined();
  });

  it('markDefaulted() rejects an already-PAID_OFF facility', async () => {
    const { service } = makeService({
      facility: makeFacility({ status: DebtFacilityStatus.PAID_OFF }),
    });
    await expect(service.markDefaulted(ORG, 'facility-1')).rejects.toThrow(BadRequestException);
  });

  it('update() rejects editing a non-PROPOSED facility directly', async () => {
    const { service } = makeService({
      facility: makeFacility({ status: DebtFacilityStatus.ACTIVE }),
    });
    await expect(service.update(ORG, 'facility-1', { name: 'New name' })).rejects.toThrow(
      BadRequestException,
    );
  });
});
