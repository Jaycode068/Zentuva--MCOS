import { PrismaClient, WhatsAppDeliveryStatus } from '@prisma/client';

import { ConsumerWhatsAppDeliveryRepository } from './consumer-whatsapp-delivery.repository';

/**
 * Sprint 43 — D2C Operations, Notifications & Production Hardening (brief §Phase 18
 * "Database/Concurrency Testing", item 1: "Two notification retries for the same
 * failed notification cannot produce unintended duplicate internal delivery
 * records"). A genuine PostgreSQL concurrency test for
 * `ConsumerWhatsAppDeliveryRepository.claimForRetry` — the exact conditional-
 * `updateMany` atomic primitive `ConsumerCommunicationService.retry` relies on,
 * mirroring Sprint 42's own "test the atomic primitive directly against real
 * Postgres" technique (a mocked repository runs to completion in one synchronous
 * tick and can never prove or disprove a genuine lost-update race).
 *
 * Deliberately NOT part of the default `pnpm test` run (see `jest.integration
 * .config.js`) — run explicitly with `pnpm run test:integration`.
 */
describe('ConsumerWhatsAppDelivery retry concurrency (real PostgreSQL, genuine concurrent transactions)', () => {
  const prisma = new PrismaClient();
  const repository = new ConsumerWhatsAppDeliveryRepository(prisma as never);

  let organisationId: string;
  const consumerIds: string[] = [];
  const salesOrderIds: string[] = [];
  const deliveryIds: string[] = [];
  const secondOrganisationIds: string[] = [];

  beforeAll(async () => {
    const organisation = await prisma.organisation.findFirstOrThrow({ select: { id: true } });
    organisationId = organisation.id;
  });

  afterAll(async () => {
    await prisma.consumerWhatsAppDelivery.deleteMany({ where: { id: { in: deliveryIds } } });
    await prisma.salesOrder.deleteMany({ where: { id: { in: salesOrderIds } } });
    await prisma.consumer.deleteMany({ where: { id: { in: consumerIds } } });
    await prisma.organisation.deleteMany({ where: { id: { in: secondOrganisationIds } } });
    await prisma.$disconnect();
  });

  function suffix(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  async function makeConsumer(): Promise<string> {
    const s = suffix();
    const consumer = await prisma.consumer.create({
      data: {
        organisationId,
        consumerCode: `CONC43-${s}`,
        fullName: 'Sprint 43 Concurrency Test Consumer',
        phoneNumber: `0802${s.slice(-7)}`,
        normalizedPhone: `+234802${s.slice(-7)}`,
      },
    });
    consumerIds.push(consumer.id);
    return consumer.id;
  }

  async function makeSalesOrder(consumerId: string): Promise<string> {
    const s = suffix();
    const order = await prisma.salesOrder.create({
      data: {
        organisationId,
        orderCode: `SO-CONC43-${s}`,
        consumerId,
        source: 'D2C',
        status: 'CONFIRMED',
        orderDate: new Date(),
        subtotal: 1500,
        total: 1500,
      },
    });
    salesOrderIds.push(order.id);
    return order.id;
  }

  async function makeFailedDelivery(consumerId: string, salesOrderId: string): Promise<string> {
    const delivery = await repository.create({
      organisationId,
      consumerId,
      salesOrderId,
      kind: 'COLLECTION_READY',
      recipientPhoneSnapshot: '+2348012345678',
      messageSnapshot: 'Your order is ready for collection.',
      status: WhatsAppDeliveryStatus.FAILED,
    });
    deliveryIds.push(delivery.id);
    return delivery.id;
  }

  it('Scenario — five concurrent retry claims for the SAME failed delivery: exactly one winner', async () => {
    const consumerId = await makeConsumer();
    const salesOrderId = await makeSalesOrder(consumerId);
    const deliveryId = await makeFailedDelivery(consumerId, salesOrderId);

    const results = await Promise.all(
      Array.from({ length: 5 }, () => repository.claimForRetry(organisationId, deliveryId)),
    );

    const winners = results.filter((r) => r !== null);
    expect(winners).toHaveLength(1);

    const final = await prisma.consumerWhatsAppDelivery.findUniqueOrThrow({
      where: { id: deliveryId },
    });
    expect(final.status).toBe(WhatsAppDeliveryStatus.PROCESSING);
  });

  it('a second claim attempt after the first already won sees zero rows matched (no double-claim)', async () => {
    const consumerId = await makeConsumer();
    const salesOrderId = await makeSalesOrder(consumerId);
    const deliveryId = await makeFailedDelivery(consumerId, salesOrderId);

    const first = await repository.claimForRetry(organisationId, deliveryId);
    expect(first).not.toBeNull();

    const second = await repository.claimForRetry(organisationId, deliveryId);
    expect(second).toBeNull();
  });

  it('markSent/markFailed never create a second row — the SAME delivery id is updated in place regardless of how many attempts occurred', async () => {
    const consumerId = await makeConsumer();
    const salesOrderId = await makeSalesOrder(consumerId);
    const deliveryId = await makeFailedDelivery(consumerId, salesOrderId);

    await repository.claimForRetry(organisationId, deliveryId);
    await repository.markFailed(organisationId, deliveryId, {
      providerName: 'local',
      errorCode: 'WHATSAPP_UNKNOWN',
      isFirstAttempt: false,
    });

    const count = await prisma.consumerWhatsAppDelivery.count({
      where: { organisationId, consumerId, salesOrderId },
    });
    expect(count).toBe(1);
  });

  // Sprint 43 brief §Phase 15 "Tenant Isolation" — a caller authenticated into a
  // DIFFERENT organisation must never read or mutate this delivery, even knowing its
  // real id (never trusting a client-supplied organisationId implicitly, nor matching
  // on id alone).
  it('a delivery is invisible and unclaimable from a different organisation, even with the correct id', async () => {
    const consumerId = await makeConsumer();
    const salesOrderId = await makeSalesOrder(consumerId);
    const deliveryId = await makeFailedDelivery(consumerId, salesOrderId);

    const s = suffix();
    const otherOrganisation = await prisma.organisation.create({
      data: {
        name: 'Sprint 43 Tenant Isolation Test Org',
        slug: `sprint43-tenant-test-${s}`,
        organisationCode: `T43-${s}`,
        businessEmail: `tenant-test-${s}@example.test`,
        country: 'NG',
      },
    });
    secondOrganisationIds.push(otherOrganisation.id);

    expect(await repository.findById(otherOrganisation.id, deliveryId)).toBeNull();
    expect(await repository.claimForRetry(otherOrganisation.id, deliveryId)).toBeNull();

    // The real owning organisation can still see/claim it — proves the above was
    // tenant-scoping, not simply a broken query.
    expect(await repository.findById(organisationId, deliveryId)).not.toBeNull();
  });
});
