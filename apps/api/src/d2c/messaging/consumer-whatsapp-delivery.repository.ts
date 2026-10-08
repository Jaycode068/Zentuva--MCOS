import { Injectable } from '@nestjs/common';
import { ConsumerWhatsAppDelivery, Prisma, WhatsAppDeliveryStatus } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

/** A retry claim treats a `PROCESSING` row as abandoned (safely re-claimable) once it has
 *  sat there this long without resolving to `SENT`/`FAILED` — covers the one realistic
 *  failure mode (the API process crashing mid-retry, between the claim and the provider
 *  call/finalize) since retry here is always a single synchronous HTTP request, never a
 *  background sweep. Mirrors `WhatsAppDelivery`/`EmailDelivery`'s own stale-lease
 *  reclaim, reusing `updatedAt` itself as the lease timestamp rather than adding a
 *  dedicated lease column this table has no other use for. */
const STALE_RETRY_CLAIM_MS = 5 * 60 * 1000;

/**
 * Thin Prisma access for `ConsumerWhatsAppDelivery` (Sprint 43,
 * docs/domains/d2c.md "Consumer Communication Delivery Visibility"). No business logic —
 * see `WhatsAppConsumerNotificationService` (writes the initial attempt) and
 * `ConsumerCommunicationService` (reads/retries).
 */
@Injectable()
export class ConsumerWhatsAppDeliveryRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(
    data: Omit<
      Prisma.ConsumerWhatsAppDeliveryCreateInput,
      'organisation' | 'consumer' | 'salesOrder'
    > & {
      organisationId: string;
      consumerId: string;
      salesOrderId: string;
    },
  ): Promise<ConsumerWhatsAppDelivery> {
    const { organisationId, consumerId, salesOrderId, ...rest } = data;
    return this.prisma.consumerWhatsAppDelivery.create({
      data: {
        ...rest,
        organisation: { connect: { id: organisationId } },
        consumer: { connect: { id: consumerId } },
        salesOrder: { connect: { id: salesOrderId } },
      },
    });
  }

  findById(organisationId: string, id: string): Promise<ConsumerWhatsAppDelivery | null> {
    return this.prisma.consumerWhatsAppDelivery.findFirst({ where: { id, organisationId } });
  }

  async findManyByConsumer(
    organisationId: string,
    consumerId: string,
    params: { page: number; pageSize: number },
  ): Promise<{ items: ConsumerWhatsAppDelivery[]; total: number }> {
    const where = { organisationId, consumerId };
    const [items, total] = await Promise.all([
      this.prisma.consumerWhatsAppDelivery.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
      this.prisma.consumerWhatsAppDelivery.count({ where }),
    ]);
    return { items, total };
  }

  findManyByOrder(
    organisationId: string,
    salesOrderId: string,
  ): Promise<ConsumerWhatsAppDelivery[]> {
    return this.prisma.consumerWhatsAppDelivery.findMany({
      where: { organisationId, salesOrderId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Added Sprint 43 — the Exceptions queue / dashboard's own read: the most recent
   *  delivery per order, across many orders in one batch query, never N+1. */
  async findLatestBySalesOrderIds(
    organisationId: string,
    salesOrderIds: string[],
  ): Promise<ConsumerWhatsAppDelivery[]> {
    if (salesOrderIds.length === 0) {
      return [];
    }
    const rows = await this.prisma.consumerWhatsAppDelivery.findMany({
      where: { organisationId, salesOrderId: { in: salesOrderIds } },
      orderBy: { createdAt: 'desc' },
    });
    const latestByOrder = new Map<string, ConsumerWhatsAppDelivery>();
    for (const row of rows) {
      if (!latestByOrder.has(row.salesOrderId)) {
        latestByOrder.set(row.salesOrderId, row);
      }
    }
    return [...latestByOrder.values()];
  }

  /** Dashboard "Communications" summary — three bounded counts, never a full scan result
   *  set. `since` is the caller's own "today" cutoff (brief: an operational dashboard,
   *  not a report — no historical trend computation here). */
  async countSinceByStatus(
    organisationId: string,
    since: Date,
  ): Promise<{ sent: number; failed: number }> {
    const [sent, failed] = await Promise.all([
      this.prisma.consumerWhatsAppDelivery.count({
        where: { organisationId, status: WhatsAppDeliveryStatus.SENT, createdAt: { gte: since } },
      }),
      this.prisma.consumerWhatsAppDelivery.count({
        where: { organisationId, status: WhatsAppDeliveryStatus.FAILED, createdAt: { gte: since } },
      }),
    ]);
    return { sent, failed };
  }

  countEligibleForRetry(organisationId: string): Promise<number> {
    return this.prisma.consumerWhatsAppDelivery.count({
      where: { organisationId, status: WhatsAppDeliveryStatus.FAILED },
    });
  }

  /** `isFirstAttempt` is decided by the CALLER (it already has the row in hand from
   *  `create()`/`claimForRetry()` and knows whether `attempts === 0`) rather than
   *  re-derived here — keeps this repository a thin Prisma access layer, no business
   *  logic of its own. `firstAttemptedAt` is set once and never overwritten by a later
   *  retry. */
  async markSent(
    organisationId: string,
    id: string,
    data: { providerName: string; providerMessageId?: string; isFirstAttempt: boolean },
  ): Promise<ConsumerWhatsAppDelivery> {
    const now = new Date();
    await this.prisma.consumerWhatsAppDelivery.updateMany({
      where: { id, organisationId },
      data: {
        status: WhatsAppDeliveryStatus.SENT,
        attempts: { increment: 1 },
        providerName: data.providerName,
        providerMessageId: data.providerMessageId,
        lastErrorCode: null,
        lastErrorMessage: null,
        ...(data.isFirstAttempt ? { firstAttemptedAt: now } : {}),
        lastAttemptedAt: now,
        sentAt: now,
      },
    });
    return this.prisma.consumerWhatsAppDelivery.findUniqueOrThrow({ where: { id } });
  }

  async markFailed(
    organisationId: string,
    id: string,
    data: {
      providerName?: string;
      errorCode?: string;
      errorMessage?: string;
      isFirstAttempt: boolean;
    },
  ): Promise<ConsumerWhatsAppDelivery> {
    const now = new Date();
    await this.prisma.consumerWhatsAppDelivery.updateMany({
      where: { id, organisationId },
      data: {
        status: WhatsAppDeliveryStatus.FAILED,
        attempts: { increment: 1 },
        providerName: data.providerName,
        lastErrorCode: data.errorCode ?? 'WHATSAPP_UNKNOWN',
        lastErrorMessage: data.errorMessage ?? null,
        ...(data.isFirstAttempt ? { firstAttemptedAt: now } : {}),
        lastAttemptedAt: now,
      },
    });
    return this.prisma.consumerWhatsAppDelivery.findUniqueOrThrow({ where: { id } });
  }

  /** The retry primitive — a conditional `updateMany` scoped to the row's CURRENT state
   *  (the exact `CollectionPointFulfillmentRepository.updateStatus` concurrency pattern):
   *  eligible from `FAILED`, or from an abandoned `PROCESSING` lease (see
   *  `STALE_RETRY_CLAIM_MS`). Two genuinely concurrent retry requests for the same row
   *  race on this single `UPDATE`; only one can match (Postgres row-level locking), the
   *  other sees `count === 0` and is told plainly this delivery is not eligible right
   *  now — never a second send, never a duplicate row. */
  async claimForRetry(
    organisationId: string,
    id: string,
  ): Promise<ConsumerWhatsAppDelivery | null> {
    const staleBefore = new Date(Date.now() - STALE_RETRY_CLAIM_MS);
    const result = await this.prisma.consumerWhatsAppDelivery.updateMany({
      where: {
        id,
        organisationId,
        OR: [
          { status: WhatsAppDeliveryStatus.FAILED },
          { status: WhatsAppDeliveryStatus.PROCESSING, updatedAt: { lt: staleBefore } },
        ],
      },
      data: { status: WhatsAppDeliveryStatus.PROCESSING },
    });
    if (result.count === 0) {
      return null;
    }
    return this.prisma.consumerWhatsAppDelivery.findUniqueOrThrow({ where: { id } });
  }
}
