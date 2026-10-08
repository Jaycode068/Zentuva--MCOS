import { PrismaClient } from '@prisma/client';

import { WhatsAppWebhookEventRepository } from './whatsapp-webhook-event.repository';

/**
 * Sprint 43.5 — D2C Two-Way Conversation Reliability (docs/domains/d2c.md
 * "Conversation Traceability," brief §Phase 18 "duplicate webhook message processing
 * cannot create duplicate business actions"). A genuine PostgreSQL concurrency test for
 * `WhatsAppWebhookEventRepository.tryClaim` — the exact atomic primitive
 * `WhatsAppInboundAdapterService.handleWebhookPayload` relies on to guarantee that Meta
 * redelivering the SAME inbound message (or two genuinely concurrent webhook deliveries
 * racing each other) is processed exactly once. Mirrors every other sprint's own "test
 * the atomic primitive directly against real Postgres" technique
 * (`inventory-stock-concurrency.integration.spec.ts`, `d2c-ordering-concurrency
 * .integration.spec.ts`, `collection-point-fulfillment-concurrency.integration.spec.ts`,
 * `consumer-whatsapp-delivery-concurrency.integration.spec.ts`) — a mocked repository
 * runs to completion in one synchronous tick and can never prove or disprove a genuine
 * lost-update/double-insert race.
 *
 * Deliberately NOT part of the default `pnpm test` run (see `jest.integration.config.js`)
 * — run explicitly with `pnpm run test:integration`.
 */
describe('WhatsApp webhook event dedup concurrency (real PostgreSQL, genuine concurrent transactions)', () => {
  const prisma = new PrismaClient();
  const repository = new WhatsAppWebhookEventRepository(prisma as never);
  const claimedIds: string[] = [];

  afterAll(async () => {
    await prisma.whatsAppWebhookEvent.deleteMany({ where: { id: { in: claimedIds } } });
    await prisma.$disconnect();
  });

  function uniqueMessageId(): string {
    return `wamid.CONC43-5-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  it('10 genuinely concurrent tryClaim calls for the SAME externalMessageId (a replayed/redelivered webhook) resolve to exactly one winner', async () => {
    const externalMessageId = uniqueMessageId();

    const results = await Promise.all(
      Array.from({ length: 10 }, () => repository.tryClaim(externalMessageId, 'INBOUND_MESSAGE')),
    );

    const winners = results.filter((claimed) => claimed === true);
    const losers = results.filter((claimed) => claimed === false);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(9);

    const rows = await prisma.whatsAppWebhookEvent.findMany({ where: { externalMessageId } });
    expect(rows).toHaveLength(1);
    claimedIds.push(rows[0]!.id);
  });

  it('two concurrent STATUS_UPDATE claims for the SAME composite id+status key also resolve to exactly one winner', async () => {
    // Mirrors the adapter's own composite key for status webhooks
    // (`${status.id}:${status.status}`) — a genuinely different id+status pair is a
    // distinct, legitimate event, never deduped against this one.
    const compositeKey = `${uniqueMessageId()}:delivered`;

    const results = await Promise.all([
      repository.tryClaim(compositeKey, 'STATUS_UPDATE'),
      repository.tryClaim(compositeKey, 'STATUS_UPDATE'),
    ]);

    expect(results.filter((claimed) => claimed === true)).toHaveLength(1);
    expect(results.filter((claimed) => claimed === false)).toHaveLength(1);

    const rows = await prisma.whatsAppWebhookEvent.findMany({
      where: { externalMessageId: compositeKey },
    });
    expect(rows).toHaveLength(1);
    claimedIds.push(rows[0]!.id);
  });

  it('two DIFFERENT externalMessageIds claimed concurrently never collide with each other', async () => {
    const idA = uniqueMessageId();
    const idB = uniqueMessageId();

    const [resultA, resultB] = await Promise.all([
      repository.tryClaim(idA, 'INBOUND_MESSAGE'),
      repository.tryClaim(idB, 'INBOUND_MESSAGE'),
    ]);

    expect(resultA).toBe(true);
    expect(resultB).toBe(true);

    const rows = await prisma.whatsAppWebhookEvent.findMany({
      where: { externalMessageId: { in: [idA, idB] } },
    });
    expect(rows).toHaveLength(2);
    claimedIds.push(...rows.map((row) => row.id));
  });
});
