import { CashAccountType } from '@prisma/client';

import { CashAccountRepository, DuplicateCashAccountCodeError } from './cash-account.repository';
import { MissingSystemAccountError } from '../accounting/journal-posting';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * A deliberate exception to this codebase's "no repository-level unit tests for
 * atomic transactions" convention — same justification as
 * `supplier-payment.repository.spec.ts`. Verifies `CashAccountRepository.create()`'s
 * real transaction logic: Chart of Accounts provisioning (per `accountType`'s
 * parent system key), the opening-balance journal posting, and idempotent replay.
 */
function makeFakeTx(seedAccounts: Record<string, unknown>[] = []) {
  const chartOfAccounts = new Map<string, Record<string, unknown>>(
    seedAccounts.map((account) => [account.id as string, account]),
  );
  const cashAccounts = new Map<string, Record<string, unknown>>();
  const journalEntries = new Map<string, Record<string, unknown>>();
  let coaSequence = 0;
  let cashAccountSequence = 0;
  let journalSequence = 0;

  return {
    tx: {
      cashAccount: {
        findUnique: jest.fn(
          async ({
            where,
          }: {
            where: {
              organisationId_idempotencyKey?: { organisationId: string; idempotencyKey: string };
            };
          }) => {
            const key = where.organisationId_idempotencyKey;
            if (!key) return null;
            for (const account of cashAccounts.values()) {
              if (
                account.organisationId === key.organisationId &&
                account.idempotencyKey === key.idempotencyKey
              ) {
                return account;
              }
            }
            return null;
          },
        ),
        count: jest.fn(
          async ({ where }: { where: { organisationId: string; accountCode: string } }) => {
            let count = 0;
            for (const account of cashAccounts.values()) {
              if (
                account.organisationId === where.organisationId &&
                account.accountCode === where.accountCode
              ) {
                count += 1;
              }
            }
            return count;
          },
        ),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          cashAccountSequence += 1;
          const id = `cash-account-${cashAccountSequence}`;
          const account = { id, ...data };
          cashAccounts.set(id, account);
          return account;
        }),
      },
      chartOfAccount: {
        findFirst: jest.fn(
          async ({
            where,
          }: {
            where: { organisationId: string; systemKey?: string; code?: string; id?: string };
          }) => {
            for (const account of chartOfAccounts.values()) {
              if (account.organisationId !== where.organisationId) continue;
              if (where.systemKey !== undefined && account.systemKey !== where.systemKey) continue;
              if (where.code !== undefined && account.code !== where.code) continue;
              if (where.id !== undefined && account.id !== where.id) continue;
              return account;
            }
            return null;
          },
        ),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          coaSequence += 1;
          const id = `coa-child-${coaSequence}`;
          const account = { id, ...data };
          chartOfAccounts.set(id, account);
          return account;
        }),
      },
      accountingPeriod: {
        findFirst: jest.fn(async () => ({ id: 'period-1', status: 'OPEN' })),
      },
      journalEntry: {
        findUnique: jest.fn(
          async ({
            where,
          }: {
            where: {
              organisationId_sourceType_sourceId?: {
                organisationId: string;
                sourceType: string;
                sourceId: string;
              };
            };
          }) => {
            const key = where.organisationId_sourceType_sourceId;
            if (!key) return null;
            for (const entry of journalEntries.values()) {
              if (
                entry.organisationId === key.organisationId &&
                entry.sourceType === key.sourceType &&
                entry.sourceId === key.sourceId
              ) {
                return entry;
              }
            }
            return null;
          },
        ),
        count: jest.fn(async () => 0),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          journalSequence += 1;
          const id = `journal-${journalSequence}`;
          const entry = { id, ...data };
          journalEntries.set(id, entry);
          return entry;
        }),
      },
    },
    chartOfAccounts,
    cashAccounts,
    journalEntries,
  };
}

function makeRepository(seedAccounts: Record<string, unknown>[] = []) {
  const fake = makeFakeTx(seedAccounts);
  const prisma = {
    $transaction: jest.fn(async (callback: (tx: unknown) => unknown) => callback(fake.tx)),
  } as unknown as PrismaService;
  return { repository: new CashAccountRepository(prisma), ...fake };
}

const ORG = 'org-1';

function seedBankSystemAccount() {
  return { id: 'coa-bank', organisationId: ORG, code: '1120', systemKey: 'BANK', type: 'ASSET' };
}

describe('CashAccountRepository.create', () => {
  it('provisions a dedicated child Chart of Accounts row under the BANK system account and posts the opening balance', async () => {
    const { repository, chartOfAccounts, journalEntries } = makeRepository([
      seedBankSystemAccount(),
      {
        id: 'coa-obe',
        organisationId: ORG,
        code: '3100',
        systemKey: 'OPENING_BALANCE_EQUITY',
        type: 'EQUITY',
      },
    ]);

    const result = await repository.create({
      organisationId: ORG,
      accountCode: 'CASH-001',
      name: 'GTBank Current Account',
      accountType: CashAccountType.BANK,
      currency: 'NGN',
      openingBalance: 10_000_000,
      openingBalanceDate: new Date('2026-01-01'),
      createdById: 'user-1',
    });

    expect(result.wasCreated).toBe(true);
    expect(result.cashAccount.linkedChartOfAccountId).toBe('coa-child-1');

    const child = chartOfAccounts.get('coa-child-1')!;
    expect(child.code).toBe('112001');
    expect(child.parentId).toBe('coa-bank');
    expect(child.isSystemAccount).toBe(false);

    expect(journalEntries.size).toBe(1);
    const [entry] = journalEntries.values();
    expect(entry!.sourceType).toBe('CASH_ACCOUNT_OPENING_BALANCE');
  });

  it('is idempotent — a replayed idempotencyKey returns the original result without re-provisioning a Chart of Accounts row', async () => {
    const { repository, chartOfAccounts } = makeRepository([seedBankSystemAccount()]);

    const first = await repository.create({
      organisationId: ORG,
      accountCode: 'CASH-001',
      name: 'GTBank',
      accountType: CashAccountType.BANK,
      currency: 'NGN',
      idempotencyKey: 'key-1',
      createdById: 'user-1',
    });
    const second = await repository.create({
      organisationId: ORG,
      accountCode: 'CASH-001',
      name: 'GTBank',
      accountType: CashAccountType.BANK,
      currency: 'NGN',
      idempotencyKey: 'key-1',
      createdById: 'user-1',
    });

    expect(first.wasCreated).toBe(true);
    expect(second.wasCreated).toBe(false);
    expect(second.cashAccount.id).toBe(first.cashAccount.id);
    // Only one child account provisioned across both calls.
    expect([...chartOfAccounts.values()].filter((a) => a.parentId === 'coa-bank')).toHaveLength(1);
  });

  it('rejects a duplicate account code for the same organisation', async () => {
    const { repository } = makeRepository([seedBankSystemAccount()]);
    await repository.create({
      organisationId: ORG,
      accountCode: 'CASH-001',
      name: 'GTBank',
      accountType: CashAccountType.BANK,
      currency: 'NGN',
      createdById: 'user-1',
    });

    await expect(
      repository.create({
        organisationId: ORG,
        accountCode: 'CASH-001',
        name: 'Access Bank',
        accountType: CashAccountType.BANK,
        currency: 'NGN',
        createdById: 'user-1',
      }),
    ).rejects.toBeInstanceOf(DuplicateCashAccountCodeError);
  });

  it('throws MissingSystemAccountError when the organisation has no BANK system account configured', async () => {
    const { repository } = makeRepository([]);
    await expect(
      repository.create({
        organisationId: ORG,
        accountCode: 'CASH-001',
        name: 'GTBank',
        accountType: CashAccountType.BANK,
        currency: 'NGN',
        createdById: 'user-1',
      }),
    ).rejects.toBeInstanceOf(MissingSystemAccountError);
  });

  it('generates a second child code when the first is already taken', async () => {
    const { repository, chartOfAccounts } = makeRepository([
      seedBankSystemAccount(),
      {
        id: 'existing-child',
        organisationId: ORG,
        code: '112001',
        parentId: 'coa-bank',
        type: 'ASSET',
      },
    ]);

    const result = await repository.create({
      organisationId: ORG,
      accountCode: 'CASH-002',
      name: 'Access Bank',
      accountType: CashAccountType.BANK,
      currency: 'NGN',
      createdById: 'user-1',
    });

    const child = chartOfAccounts.get(result.cashAccount.linkedChartOfAccountId as string)!;
    expect(child.code).toBe('112002');
  });
});
