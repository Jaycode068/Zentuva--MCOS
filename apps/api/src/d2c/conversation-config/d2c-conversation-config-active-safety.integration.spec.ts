import { PrismaClient } from '@prisma/client';

import { D2CConversationConfigService } from './d2c-conversation-config.service';
import { D2CConversationCapabilityRepository } from './d2c-conversation-capability.repository';
import { D2CConversationMessageRepository } from './d2c-conversation-message.repository';
import { D2CConversationProfileRepository } from './d2c-conversation-profile.repository';

/**
 * Sprint 44 — Tenant D2C Conversation Configuration (docs/domains/d2c.md "Tenant
 * Conversation Configuration," brief §Phase 22 "Active-conversation safety"). Proves,
 * against a REAL Postgres database, that an admin saving a configuration change while a
 * consumer is mid-flow (e.g. `ORDER_CONFIRMATION`, with an in-progress cart already
 * sitting in `context`) can NEVER corrupt that conversation's persisted state —
 * `ConsumerConversation` and the three `D2CConversation*Config` tables are entirely
 * separate tables with no trigger, cascade, or shared row between them, so a config
 * write is structurally incapable of touching conversation state. It also confirms the
 * OTHER half of the safety property: the config change DOES take effect for the very
 * next resolution — nothing here is stuck on a stale cache.
 *
 * Deliberately NOT part of the default `pnpm test` run — run explicitly via
 * `pnpm run test:integration`.
 */
describe('D2C conversation configuration — active-conversation safety (real PostgreSQL)', () => {
  const prisma = new PrismaClient();
  const capabilityRepository = new D2CConversationCapabilityRepository(prisma as never);
  const messageRepository = new D2CConversationMessageRepository(prisma as never);
  const profileRepository = new D2CConversationProfileRepository(prisma as never);
  // A thin fake for `OrganisationService` — this test exercises
  // `D2CConversationConfigService`'s own real-Postgres read/write behavior, not
  // `OrganisationService` itself, so a direct real-Prisma lookup stands in for it rather
  // than constructing that service's own full dependency graph.
  const organisationService = {
    getById: (id: string) => prisma.organisation.findUnique({ where: { id } }),
  };
  const effectiveAccessResolver = {
    resolve: jest.fn().mockResolvedValue({ isOwnerBypass: true, grants: new Set<string>() }),
  };
  const auditService = { record: jest.fn() };
  const configService = new D2CConversationConfigService(
    prisma as never,
    capabilityRepository,
    messageRepository,
    profileRepository,
    organisationService as never,
    effectiveAccessResolver as never,
    auditService as never,
  );

  const EXTERNAL_ID = 'sprint44-active-safety-test-phone';
  let orgId: string;
  let orgBId: string;
  let conversationId: string;

  beforeAll(async () => {
    const orgs = await prisma.organisation.findMany({ take: 2, select: { id: true } });
    if (orgs.length < 2) throw new Error('This test requires at least 2 seeded organisations.');
    orgId = orgs[0]!.id;
    orgBId = orgs[1]!.id;

    const conversation = await prisma.consumerConversation.create({
      data: {
        organisationId: orgId,
        channel: 'WHATSAPP',
        externalConversationId: EXTERNAL_ID,
        state: 'ACTIVE',
        context: {
          orderingState: 'ORDER_CONFIRMATION',
          cart: [{ productId: 'prod-1', quantity: 3 }],
          total: 4500,
        },
      },
    });
    conversationId = conversation.id;
  });

  afterAll(async () => {
    await prisma.consumerConversation.deleteMany({ where: { id: conversationId } });
    await prisma.d2CConversationMessageConfig.deleteMany({
      where: { organisationId: { in: [orgId, orgBId] }, messageKey: 'WELCOME' },
    });
    await prisma.d2CConversationCapabilityConfig.deleteMany({
      where: { organisationId: { in: [orgId, orgBId] }, capability: 'ORDER_SNACKS' },
    });
    await prisma.$disconnect();
  });

  it("an admin config save mid-flight never touches an active conversation's persisted state (separate tables, no cascade)", async () => {
    const before = await prisma.consumerConversation.findUniqueOrThrow({
      where: { id: conversationId },
    });

    // Simulate the admin "Save Menu" / "Save Message" actions landing WHILE this
    // consumer is sitting at ORDER_CONFIRMATION with a real in-progress cart.
    await configService.updateMessage(
      orgId,
      'actor-1',
      'WELCOME',
      'New welcome text for this tenant',
    );
    await configService.updateCapabilities(orgId, 'actor-1', [
      { capability: 'ORDER_SNACKS', enabled: true, displayLabel: '🛍️ Shop Now', sortOrder: 1 },
    ]);

    const after = await prisma.consumerConversation.findUniqueOrThrow({
      where: { id: conversationId },
    });

    expect(after.state).toBe(before.state);
    expect(after.context).toEqual(before.context);
    expect(after.consumerId).toBe(before.consumerId);
    expect(after.updatedAt).toEqual(before.updatedAt);
  });

  it("the very next config resolution DOES reflect the admin's change — no stale caching, takes effect starting the next turn", async () => {
    const resolved = await configService.resolveEffectiveConfig(orgId);
    expect(resolved.messages.WELCOME).toBe('New welcome text for this tenant');
    const orderSnacks = resolved.capabilities.find((c) => c.capability === 'ORDER_SNACKS');
    expect(orderSnacks?.displayLabel).toBe('🛍️ Shop Now');
  });

  it('Final Architectural Test (brief) — getAdminView/getPreview for two real tenants, through the real admin service methods, never cross-contaminate', async () => {
    await configService.updateMessage(orgBId, 'actor-2', 'WELCOME', 'XYZ Foods welcome text');
    await configService.updateCapabilities(orgBId, 'actor-2', [
      { capability: 'ORDER_SNACKS', enabled: true, displayLabel: '🛍️ XYZ Shop', sortOrder: 1 },
    ]);

    const [adminViewA, adminViewB] = await Promise.all([
      configService.getAdminView(orgId, 'actor-1'),
      configService.getAdminView(orgBId, 'actor-2'),
    ]);
    expect(adminViewA.messages.find((m) => m.messageKey === 'WELCOME')?.value).toBe(
      'New welcome text for this tenant',
    );
    expect(adminViewB.messages.find((m) => m.messageKey === 'WELCOME')?.value).toBe(
      'XYZ Foods welcome text',
    );
    expect(adminViewA.capabilities.find((c) => c.capability === 'ORDER_SNACKS')?.displayLabel).toBe(
      '🛍️ Shop Now',
    );
    expect(adminViewB.capabilities.find((c) => c.capability === 'ORDER_SNACKS')?.displayLabel).toBe(
      '🛍️ XYZ Shop',
    );

    const [previewA, previewB] = await Promise.all([
      configService.getPreview(orgId, 'actor-1'),
      configService.getPreview(orgBId, 'actor-2'),
    ]);
    expect(JSON.stringify(previewA)).toContain('New welcome text for this tenant');
    expect(JSON.stringify(previewA)).not.toContain('XYZ Foods');
    expect(JSON.stringify(previewB)).toContain('XYZ Foods welcome text');
    expect(JSON.stringify(previewB)).not.toContain('New welcome text for this tenant');
  });
});
