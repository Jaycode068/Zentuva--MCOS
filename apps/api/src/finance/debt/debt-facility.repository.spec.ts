import { DebtFacilityRepository } from './debt-facility.repository';
import { PrismaService } from '../../prisma/prisma.service';

function makeRepository() {
  const facilities = new Map<string, Record<string, unknown>>();
  const schedules = new Map<string, Record<string, unknown>>();
  let facilitySeq = 0;
  let scheduleSeq = 0;

  const tx = {
    debtFacility: {
      findUnique: jest.fn(
        async ({
          where,
        }: {
          where: {
            organisationId_idempotencyKey?: { organisationId: string; idempotencyKey: string };
            organisationId_facilityCode?: { organisationId: string; facilityCode: string };
          };
        }) => {
          const idempotencyKeyLookup = where.organisationId_idempotencyKey;
          if (idempotencyKeyLookup) {
            for (const facility of facilities.values()) {
              if (
                facility.organisationId === idempotencyKeyLookup.organisationId &&
                facility.idempotencyKey === idempotencyKeyLookup.idempotencyKey
              ) {
                return facility;
              }
            }
            return null;
          }
          const codeLookup = where.organisationId_facilityCode;
          if (codeLookup) {
            for (const facility of facilities.values()) {
              if (
                facility.organisationId === codeLookup.organisationId &&
                facility.facilityCode === codeLookup.facilityCode
              ) {
                return facility;
              }
            }
            return null;
          }
          return null;
        },
      ),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        facilitySeq += 1;
        const id = `facility-${facilitySeq}`;
        const facility = { id, ...data };
        facilities.set(id, facility);
        return facility;
      }),
    },
    debtRepaymentSchedule: {
      createMany: jest.fn(async ({ data }: { data: Record<string, unknown>[] }) => {
        for (const row of data) {
          scheduleSeq += 1;
          schedules.set(`sched-${scheduleSeq}`, { id: `sched-${scheduleSeq}`, ...row });
        }
        return { count: data.length };
      }),
      findMany: jest.fn(async ({ where }: { where: { debtFacilityId: string } }) =>
        [...schedules.values()]
          .filter((row) => row.debtFacilityId === where.debtFacilityId)
          .sort((a, b) => (a.installmentNumber as number) - (b.installmentNumber as number)),
      ),
      updateMany: jest.fn(async () => ({ count: 0 })),
    },
  };

  const prisma = {
    $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb(tx)),
  } as unknown as PrismaService;

  return { repository: new DebtFacilityRepository(prisma), facilities, schedules };
}

const ORG = 'org-1';

function baseData(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    organisationId: ORG,
    lenderId: 'lender-1',
    name: 'Bank Equipment Loan',
    debtType: 'TERM_LOAN',
    principalAmount: 60_000_000,
    currency: 'NGN',
    interestRatePercent: 20,
    repaymentMethod: 'AMORTISING',
    repaymentFrequency: 'MONTHLY',
    startDate: new Date(2026, 0, 1),
    tenorMonths: 24,
    graceMonths: 0,
    liabilityAccountId: 'account-liability',
    interestExpenseAccountId: 'account-interest',
    createdById: 'user-1',
    ...overrides,
  } as never;
}

describe('DebtFacilityRepository.create', () => {
  it('generates facilityCode DEBT-000001 and persists the full 24-installment schedule in the same transaction', async () => {
    const { repository, schedules } = makeRepository();
    const result = await repository.create(baseData());

    expect(result.wasCreated).toBe(true);
    expect(result.debtFacility.facilityCode).toBe('DEBT-000001');
    expect(result.debtFacility.maturityDate).toEqual(new Date(2028, 0, 1));
    expect(schedules.size).toBe(24);
  });

  it('generates the next sequential facilityCode when one already exists', async () => {
    const { repository } = makeRepository();
    await repository.create(baseData());
    const second = await repository.create(baseData({ idempotencyKey: 'second' }));
    expect(second.debtFacility.facilityCode).toBe('DEBT-000002');
  });

  it('is idempotent — a replayed idempotencyKey returns the original result, no duplicate schedule', async () => {
    const { repository, facilities, schedules } = makeRepository();
    const input = baseData({ idempotencyKey: 'facility-key-1' });

    const first = await repository.create(input);
    const second = await repository.create(input);

    expect(first.wasCreated).toBe(true);
    expect(second.wasCreated).toBe(false);
    expect(second.debtFacility.id).toBe(first.debtFacility.id);
    expect(facilities.size).toBe(1);
    expect(schedules.size).toBe(24);
  });
});
