import { PrismaClient } from '@prisma/client';

import { EXPECTED_TEST_ROLE, verifyConnectedToTestDatabase } from './test-db-guard';

/**
 * Regression coverage for the Test Database Isolation & Destructive-Operation Safety
 * sprint (docs/sprint-test-database-isolation-completion-report.md). Runs ONLY under
 * jest.integration.config.js, which (via globalSetup/setupFiles) guarantees this file's
 * `prisma` client is already pointed at the isolated, disposable `zentuva_test` database
 * before this file is even loaded — if that could not be verified, the whole run aborts
 * before reaching this file. These tests then prove properties ABOUT that isolation,
 * using only fixture data created and destroyed inside this file.
 *
 * This file does not, and must not, connect to the operational database under any
 * circumstance — including to prove a negative. "Test credentials cannot access the
 * operational database" is instead established architecturally (see completion report
 * "Evidence that the test role cannot access the operational database"): `zentuva_test`
 * is a role that exists only inside the separate `postgres-test` container's own catalog
 * (scripts/db/init-test-role.sql) — it has no entry at all in the operational Postgres
 * instance's `pg_roles`, so no connection string naming it could ever authenticate there,
 * independent of any application-level check.
 */
describe('Test database isolation — safety regression scenarios', () => {
  const prisma = new PrismaClient();

  let organisationId: string;
  let accountingPeriodId: string;
  let accountId: string;

  function uniqueSuffix(): string {
    return `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  }

  beforeAll(async () => {
    const suffix = uniqueSuffix();
    const organisation = await prisma.organisation.create({
      data: {
        name: `DB Isolation Safety Test Org ${suffix}`,
        slug: `db-isolation-safety-${suffix}`,
        organisationCode: `DIS-${suffix}`,
        businessEmail: `dis-${suffix}@example.test`,
        country: 'NG',
      },
    });
    organisationId = organisation.id;

    const period = await prisma.accountingPeriod.create({
      data: {
        organisationId,
        name: `DIS Test Period ${suffix}`,
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-01-31'),
        status: 'OPEN',
      },
    });
    accountingPeriodId = period.id;

    const account = await prisma.chartOfAccount.create({
      data: {
        organisationId,
        code: `DIS-${suffix}`,
        name: 'DB Isolation Safety Test Account',
        type: 'EXPENSE',
      },
    });
    accountId = account.id;
  });

  afterAll(async () => {
    await prisma.journalEntryLine.deleteMany({ where: { journalEntry: { organisationId } } });
    await prisma.journalEntry.deleteMany({ where: { organisationId } });
    await prisma.chartOfAccount.deleteMany({ where: { organisationId } });
    await prisma.accountingPeriod.deleteMany({ where: { organisationId } });
    await prisma.organisation.delete({ where: { id: organisationId } });
    await prisma.$disconnect();
  });

  async function createJournalEntry(sourceId: string, totalAmount: number) {
    return prisma.journalEntry.create({
      data: {
        organisationId,
        journalNumber: `DIS-${sourceId}`,
        date: new Date('2026-01-15'),
        accountingPeriodId,
        description: `DB isolation safety fixture (${sourceId})`,
        sourceType: 'SALES_FULFILMENT',
        sourceId,
        status: 'POSTED',
        lines: {
          create: [
            { accountId, debit: totalAmount, credit: 0 },
            { accountId, debit: 0, credit: totalAmount },
          ],
        },
      },
      include: { lines: true },
    });
  }

  // Scenario 1 — correct isolated database: a valid test configuration connects to the
  // isolated database and runs setup/cleanup successfully. If this test can even run (and
  // its own beforeAll/afterAll succeed), the isolated database is reachable and writable
  // by the test role end to end. The explicit identity re-check below is on top of what
  // globalSetup already verified, confirming it still holds mid-suite, not just at startup.
  it('Scenario 1 — connects to, and can read/write, the verified isolated test database', async () => {
    await expect(verifyConnectedToTestDatabase(prisma)).resolves.toBeUndefined();
    const probe = await createJournalEntry(`scenario1-${uniqueSuffix()}`, 100);
    expect(probe.id).toBeDefined();
    const found = await prisma.journalEntry.findUnique({ where: { id: probe.id } });
    expect(found).not.toBeNull();
  });

  // Scenario 5 — insufficient test permissions. Verified against THIS disposable
  // database only (never the operational one, per the file-level comment above): the
  // connected role must genuinely lack every elevated privilege, confirmed live against
  // pg_roles, and a real attempt to use a superuser-only privilege (CREATEDB) must be
  // rejected by Postgres itself — proving the restriction is enforced at the database
  // level, not merely a label in a config file.
  it('Scenario 5 — the connected test role has no elevated privileges, and Postgres itself rejects a privileged operation', async () => {
    const [role] = await prisma.$queryRaw<
      {
        rolname: string;
        rolsuper: boolean;
        rolcreatedb: boolean;
        rolcreaterole: boolean;
        rolbypassrls: boolean;
      }[]
    >`SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls FROM pg_roles WHERE rolname = current_user`;

    if (!role) {
      throw new Error('Could not resolve the connected role from pg_roles.');
    }
    expect(role.rolname).toBe(EXPECTED_TEST_ROLE);
    expect(role.rolsuper).toBe(false);
    expect(role.rolcreatedb).toBe(false);
    expect(role.rolcreaterole).toBe(false);
    expect(role.rolbypassrls).toBe(false);

    await expect(
      prisma.$executeRawUnsafe(
        `CREATE DATABASE dis_privilege_probe_${uniqueSuffix().replace(/-/g, '_')}`,
      ),
    ).rejects.toThrow();
  });

  // Scenario 6 — test-owned cleanup: removes only the records it owns, leaving an
  // unrelated fixture (simulating another concurrently-running test's data) untouched.
  it('Scenario 6 — scoped cleanup removes only test-owned records and leaves an unrelated fixture untouched', async () => {
    const ownedId = `scenario6-owned-${uniqueSuffix()}`;
    const unrelatedId = `scenario6-unrelated-${uniqueSuffix()}`;
    const owned = await createJournalEntry(ownedId, 500);
    const unrelated = await createJournalEntry(unrelatedId, 700);

    // The exact shape of the FIXED cleanup in sales-fulfilment-outlet-integration
    // .integration.spec.ts: resolve exact owned ids first, then scope every deletion to
    // them specifically.
    const ownedIds = [owned.sourceId!];
    await prisma.journalEntryLine.deleteMany({
      where: {
        journalEntry: {
          organisationId,
          sourceType: 'SALES_FULFILMENT',
          sourceId: { in: ownedIds },
        },
      },
    });
    await prisma.journalEntry.deleteMany({
      where: { organisationId, sourceType: 'SALES_FULFILMENT', sourceId: { in: ownedIds } },
    });

    expect(await prisma.journalEntry.findUnique({ where: { id: owned.id } })).toBeNull();
    const survivingUnrelated = await prisma.journalEntry.findUnique({
      where: { id: unrelated.id },
      include: { lines: true },
    });
    expect(survivingUnrelated).not.toBeNull();
    expect(survivingUnrelated!.lines).toHaveLength(2);
  });

  // Scenario 7 — financial-record isolation: representative journal entries created in
  // this disposable database, the cleanup pathway exercised, and the record outside the
  // intended test scope proven unchanged (id, lines, and monetary totals all intact) —
  // not merely "not deleted" but byte-for-byte identical afterward.
  it('Scenario 7 — a financial record outside the intended cleanup scope is completely unchanged afterward', async () => {
    const inScopeId = `scenario7-inscope-${uniqueSuffix()}`;
    const outOfScopeId = `scenario7-outofscope-${uniqueSuffix()}`;
    const inScope = await createJournalEntry(inScopeId, 1234);
    const outOfScope = await createJournalEntry(outOfScopeId, 5678);
    const beforeSnapshot = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: outOfScope.id },
      include: { lines: true },
    });

    const scopedIds = [inScope.sourceId!];
    await prisma.journalEntryLine.deleteMany({
      where: {
        journalEntry: {
          organisationId,
          sourceType: 'SALES_FULFILMENT',
          sourceId: { in: scopedIds },
        },
      },
    });
    await prisma.journalEntry.deleteMany({
      where: { organisationId, sourceType: 'SALES_FULFILMENT', sourceId: { in: scopedIds } },
    });

    const afterSnapshot = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: outOfScope.id },
      include: { lines: true },
    });
    expect(afterSnapshot).toEqual(beforeSnapshot);
  });

  // Scenario 8 — original regression: proves the SPECIFIC failure mode from the Phase 2C
  // incident (docs/sprint-phase-2c-financial-integrity-review.md §B) — a bare
  // `sourceType`-only filter, with no `sourceId` restriction — cannot recur through the
  // repaired cleanup pathway, by contrasting it directly against the old, unscoped shape
  // in the SAME disposable database. This does not "recreate the incident" (no real
  // business data exists in this database at all); it demonstrates, with fixture data
  // only, that the old pattern was dangerous and the new one is not.
  it('Scenario 8 — the original bare sourceType-only filter would have deleted an unrelated entry; the repaired scoped filter does not', async () => {
    const survivorId = `scenario8-survivor-${uniqueSuffix()}`;
    const survivor = await createJournalEntry(survivorId, 999);

    // The REPAIRED pattern (sourceId scoped to an empty/unrelated set): must leave the
    // survivor untouched.
    await prisma.journalEntry.deleteMany({
      where: {
        organisationId,
        sourceType: 'SALES_FULFILMENT',
        sourceId: { in: ['some-other-fulfilment-id-not-this-one'] },
      },
    });
    expect(await prisma.journalEntry.findUnique({ where: { id: survivor.id } })).not.toBeNull();

    // The ORIGINAL buggy pattern — bare `sourceType` filter, no `sourceId` restriction at
    // all — would have deleted it. Proven here only to establish the contrast; this
    // exact unscoped shape has been removed from the real cleanup function (see
    // sales-fulfilment-outlet-integration.integration.spec.ts `cleanupTestData`).
    await prisma.journalEntryLine.deleteMany({
      where: { journalEntry: { organisationId, sourceType: 'SALES_FULFILMENT' } },
    });
    await prisma.journalEntry.deleteMany({
      where: { organisationId, sourceType: 'SALES_FULFILMENT' },
    });
    expect(await prisma.journalEntry.findUnique({ where: { id: survivor.id } })).toBeNull();
  });
});
