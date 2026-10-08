import { PrismaClient } from '@prisma/client';

import { D2CConversationCapabilityRepository } from './d2c-conversation-capability.repository';
import { D2CConversationMessageRepository } from './d2c-conversation-message.repository';

/**
 * Sprint 44 — Tenant D2C Conversation Configuration (docs/domains/d2c.md "Tenant
 * Conversation Configuration," brief §Phase 31 "Database Concurrency"). A genuine
 * PostgreSQL concurrency test for the repository-level upsert primitives
 * `D2CConversationConfigService` relies on — mirrors every other sprint's own "test the
 * atomic primitive directly against real Postgres" technique; a mocked repository runs
 * to completion in one synchronous tick and can never prove or disprove a genuine
 * lost-update/cross-row race.
 *
 * Deliberately NOT part of the default `pnpm test` run (see `jest.integration.config.js`)
 * — run explicitly with `pnpm run test:integration`.
 */
describe('D2C conversation configuration concurrency (real PostgreSQL, genuine concurrent transactions)', () => {
  const prisma = new PrismaClient();
  const capabilityRepository = new D2CConversationCapabilityRepository(prisma as never);
  const messageRepository = new D2CConversationMessageRepository(prisma as never);

  let orgA: string;
  let orgB: string;

  beforeAll(async () => {
    const orgs = await prisma.organisation.findMany({ take: 2, select: { id: true } });
    if (orgs.length < 2) {
      throw new Error('This test requires at least 2 seeded organisations.');
    }
    [orgA, orgB] = [orgs[0]!.id, orgs[1]!.id];
  });

  afterAll(async () => {
    await prisma.d2CConversationMessageConfig.deleteMany({
      where: { organisationId: { in: [orgA, orgB] } },
    });
    await prisma.d2CConversationCapabilityConfig.deleteMany({
      where: { organisationId: { in: [orgA, orgB] } },
    });
    await prisma.$disconnect();
  });

  it('two genuinely concurrent updates to the SAME message key on the SAME tenant resolve to exactly one final, uncorrupted value (never a torn write)', async () => {
    await Promise.all([
      messageRepository.upsert(orgA, 'WELCOME', 'Welcome message A'),
      messageRepository.upsert(orgA, 'WELCOME', 'Welcome message B'),
    ]);

    const rows = await prisma.d2CConversationMessageConfig.findMany({
      where: { organisationId: orgA, messageKey: 'WELCOME' },
    });
    // Exactly one row exists (the unique constraint on [organisationId, messageKey]
    // guarantees this), and its value is ONE of the two genuinely-raced writes, never a
    // mixed/corrupted string.
    expect(rows).toHaveLength(1);
    expect(['Welcome message A', 'Welcome message B']).toContain(rows[0]!.value);
  });

  it('two concurrent updates to DIFFERENT message keys on the same tenant never interfere with each other', async () => {
    await Promise.all([
      messageRepository.upsert(orgA, 'HELP', 'Call us!'),
      messageRepository.upsert(orgA, 'ASK_NAME', "What's your name, friend?"),
    ]);

    const help = await prisma.d2CConversationMessageConfig.findUnique({
      where: { organisationId_messageKey: { organisationId: orgA, messageKey: 'HELP' } },
    });
    const askName = await prisma.d2CConversationMessageConfig.findUnique({
      where: { organisationId_messageKey: { organisationId: orgA, messageKey: 'ASK_NAME' } },
    });
    expect(help?.value).toBe('Call us!');
    expect(askName?.value).toBe("What's your name, friend?");
  });

  it('a concurrent update and reset-to-default on the same message key resolve to exactly one consistent final state — either the update survives, or the row is genuinely gone (never a half-written row)', async () => {
    await messageRepository.upsert(orgA, 'MY_ORDERS_EMPTY', 'Original value');

    await Promise.all([
      messageRepository.upsert(orgA, 'MY_ORDERS_EMPTY', 'Updated value'),
      messageRepository.delete(orgA, 'MY_ORDERS_EMPTY'),
    ]);

    const row = await prisma.d2CConversationMessageConfig.findUnique({
      where: { organisationId_messageKey: { organisationId: orgA, messageKey: 'MY_ORDERS_EMPTY' } },
    });
    // Whichever operation's statement committed last wins — either the row holds the
    // updated value, or it is gone entirely (reset won). What must NEVER happen: a
    // Prisma/Postgres error, or a row with a corrupted/empty value.
    if (row) {
      expect(row.value).toBe('Updated value');
    } else {
      expect(row).toBeNull();
    }
  });

  it('concurrent capability saves for Tenant A and Tenant B never cross-contaminate — each tenant reads back ONLY its own write', async () => {
    await Promise.all([
      capabilityRepository.upsert(orgA, 'ORDER_SNACKS', {
        enabled: true,
        displayLabel: 'Tenant A Label',
        sortOrder: 1,
      }),
      capabilityRepository.upsert(orgB, 'ORDER_SNACKS', {
        enabled: false,
        displayLabel: 'Tenant B Label',
        sortOrder: 9,
      }),
    ]);

    const rowA = await prisma.d2CConversationCapabilityConfig.findUnique({
      where: { organisationId_capability: { organisationId: orgA, capability: 'ORDER_SNACKS' } },
    });
    const rowB = await prisma.d2CConversationCapabilityConfig.findUnique({
      where: { organisationId_capability: { organisationId: orgB, capability: 'ORDER_SNACKS' } },
    });
    expect(rowA?.displayLabel).toBe('Tenant A Label');
    expect(rowA?.enabled).toBe(true);
    expect(rowB?.displayLabel).toBe('Tenant B Label');
    expect(rowB?.enabled).toBe(false);
  });

  it('a read for Tenant A during a concurrent write storm for Tenant B never observes Tenant B data', async () => {
    const writes = Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        messageRepository.upsert(orgB, 'LOCATION_UPDATED', `Tenant B write #${i}`),
      ),
    );
    const [, readDuringWrite] = await Promise.all([
      writes,
      messageRepository.findManyByOrganisation(orgA),
    ]);
    expect(readDuringWrite.every((row) => row.organisationId === orgA)).toBe(true);
  });
});
