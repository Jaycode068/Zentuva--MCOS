import { Injectable } from '@nestjs/common';
import { Prisma, WhatsAppDelivery, WhatsAppDeliveryStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

export interface ListWhatsAppDeliveriesParams {
  status?: WhatsAppDeliveryStatus;
  skip?: number;
  take?: number;
}

/**
 * Thin Prisma access for `WhatsAppDelivery` — no business logic, mirrors
 * `EmailDeliveryRepository` (Sprint 28) field-for-field where the schema
 * allows. Concurrency-safety convention: every status transition is a
 * conditional `updateMany` whose `WHERE` includes the expected current
 * state — `count === 0` means "someone else already moved it."
 */
@Injectable()
export class WhatsAppDeliveryRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(organisationId: string, id: string): Promise<WhatsAppDelivery | null> {
    return this.prisma.whatsAppDelivery.findFirst({ where: { id, organisationId } });
  }

  findByNotification(
    organisationId: string,
    notificationId: string,
  ): Promise<WhatsAppDelivery | null> {
    return this.prisma.whatsAppDelivery.findFirst({
      where: { organisationId, notificationId, channel: 'WHATSAPP' },
    });
  }

  findManyByOrganisation(
    organisationId: string,
    params: ListWhatsAppDeliveriesParams = {},
  ): Promise<WhatsAppDelivery[]> {
    return this.prisma.whatsAppDelivery.findMany({
      where: { organisationId, ...(params.status ? { status: params.status } : {}) },
      orderBy: { createdAt: 'desc' },
      skip: params.skip,
      take: params.take,
    });
  }

  count(organisationId: string, params: ListWhatsAppDeliveriesParams = {}): Promise<number> {
    return this.prisma.whatsAppDelivery.count({
      where: { organisationId, ...(params.status ? { status: params.status } : {}) },
    });
  }

  /** Sprint 29 §5 "Idempotency" — the database unique constraint
   *  (`[organisationId, notificationId, channel]`) is the real guarantee; a
   *  P2002 violation here means another concurrent call already created this
   *  exact delivery, treated as a benign no-op (`null`), never an error —
   *  mirrors `EmailDeliveryRepository.create` exactly. */
  async create(
    data: Prisma.WhatsAppDeliveryUncheckedCreateInput,
  ): Promise<WhatsAppDelivery | null> {
    try {
      return await this.prisma.whatsAppDelivery.create({ data });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return null;
      }
      throw error;
    }
  }

  /** The claim step — Sprint 29 §16 "Claiming." Only rows that are `PENDING`
   *  (and due, `nextRetryAt` null or in the past) or an abandoned
   *  `PROCESSING` lease (`processingStartedAt` older than `staleBefore`) are
   *  eligible; each is claimed with its OWN conditional `updateMany` so a
   *  concurrent claimer racing the exact same row loses cleanly
   *  (`count === 0`) rather than both proceeding. */
  async claimBatch(
    organisationId: string,
    staleBefore: Date,
    limit: number,
  ): Promise<WhatsAppDelivery[]> {
    const now = new Date();
    const candidates = await this.prisma.whatsAppDelivery.findMany({
      where: {
        organisationId,
        OR: [
          { status: 'PENDING', OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }] },
          { status: 'PROCESSING', processingStartedAt: { lt: staleBefore } },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });

    const claimed: WhatsAppDelivery[] = [];
    for (const candidate of candidates) {
      const result = await this.prisma.whatsAppDelivery.updateMany({
        where: {
          id: candidate.id,
          OR: [
            { status: 'PENDING' },
            { status: 'PROCESSING', processingStartedAt: { lt: staleBefore } },
          ],
        },
        data: { status: 'PROCESSING', processingStartedAt: now },
      });
      if (result.count > 0) claimed.push(candidate);
    }
    return claimed;
  }

  /** Success path — only succeeds against a row THIS process claimed
   *  (`status: 'PROCESSING'`), so a stale/duplicate call can never mark an
   *  already-terminal row `SENT` twice. */
  async markSent(
    organisationId: string,
    id: string,
    data: { providerName: string; providerMessageId?: string },
  ): Promise<boolean> {
    const result = await this.prisma.whatsAppDelivery.updateMany({
      where: { id, organisationId, status: 'PROCESSING' },
      data: {
        status: 'SENT',
        processedAt: new Date(),
        attempts: { increment: 1 },
        providerName: data.providerName,
        providerMessageId: data.providerMessageId,
        lastErrorCode: null,
        lastErrorMessage: null,
        nextRetryAt: null,
      },
    });
    return result.count > 0;
  }

  /** Failure path — `terminal` (attempts exhausted, or a `TERMINAL_FAILURE`
   *  outcome) moves straight to `FAILED`; otherwise back to `PENDING` with a
   *  scheduled `nextRetryAt`. Bounded `errorMessage` (2000 chars). */
  async markFailed(
    organisationId: string,
    id: string,
    data: {
      terminal: boolean;
      providerName: string;
      errorCode?: string;
      errorMessage?: string;
      nextRetryAt: Date | null;
    },
  ): Promise<boolean> {
    const result = await this.prisma.whatsAppDelivery.updateMany({
      where: { id, organisationId, status: 'PROCESSING' },
      data: {
        status: data.terminal ? 'FAILED' : 'PENDING',
        attempts: { increment: 1 },
        providerName: data.providerName,
        lastErrorCode: data.errorCode?.slice(0, 100),
        lastErrorMessage: data.errorMessage?.slice(0, 2000),
        nextRetryAt: data.terminal ? null : data.nextRetryAt,
      },
    });
    return result.count > 0;
  }

  /** Manual admin retry (Sprint 29 §16 "Manual retry") — eligible from
   *  `FAILED` or a stuck `PROCESSING` row; bypasses backoff, does NOT reset
   *  `attempts` (full history preserved). */
  async manualRetry(organisationId: string, id: string): Promise<boolean> {
    const result = await this.prisma.whatsAppDelivery.updateMany({
      where: { id, organisationId, status: { in: ['FAILED', 'PROCESSING'] } },
      data: { status: 'PENDING', nextRetryAt: new Date() },
    });
    return result.count > 0;
  }
}
