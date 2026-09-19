import { Injectable } from '@nestjs/common';
import { EmailDelivery, EmailDeliveryStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

export interface ListEmailDeliveriesParams {
  status?: EmailDeliveryStatus;
  skip?: number;
  take?: number;
}

/**
 * Thin Prisma access for `EmailDelivery` — no business logic, matching this
 * codebase's repository/service split throughout. Concurrency-safety convention
 * (Sprint 27.1's own precedent, `WorkflowEvent`'s claim query): every status
 * transition is a conditional `updateMany` whose `WHERE` includes the expected
 * current state — `count === 0` means "someone else already moved it."
 */
@Injectable()
export class EmailDeliveryRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(organisationId: string, id: string): Promise<EmailDelivery | null> {
    return this.prisma.emailDelivery.findFirst({ where: { id, organisationId } });
  }

  findByNotification(
    organisationId: string,
    notificationId: string,
  ): Promise<EmailDelivery | null> {
    return this.prisma.emailDelivery.findFirst({
      where: { organisationId, notificationId, channel: 'EMAIL' },
    });
  }

  findManyByOrganisation(
    organisationId: string,
    params: ListEmailDeliveriesParams = {},
  ): Promise<EmailDelivery[]> {
    return this.prisma.emailDelivery.findMany({
      where: { organisationId, ...(params.status ? { status: params.status } : {}) },
      orderBy: { createdAt: 'desc' },
      skip: params.skip,
      take: params.take,
    });
  }

  count(organisationId: string, params: ListEmailDeliveriesParams = {}): Promise<number> {
    return this.prisma.emailDelivery.count({
      where: { organisationId, ...(params.status ? { status: params.status } : {}) },
    });
  }

  /** Sprint 28 §4.3 "Idempotency" — the database unique constraint
   *  (`[organisationId, notificationId, channel]`) is the real guarantee; a P2002
   *  violation here means another concurrent call already created this exact
   *  delivery, and is treated as a benign no-op (`null`), never an error — mirrors
   *  `Notification`'s own `createMany({ skipDuplicates: true })` intent, just
   *  expressed as a single `create()` since callers need the created row back. */
  async create(data: Prisma.EmailDeliveryUncheckedCreateInput): Promise<EmailDelivery | null> {
    try {
      return await this.prisma.emailDelivery.create({ data });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return null;
      }
      throw error;
    }
  }

  /** The claim step — Sprint 28 §8.1 "Claiming." Only rows that are `PENDING` (and
   *  due, `nextRetryAt` null or in the past) or an abandoned `PROCESSING` lease
   *  (older than `staleBefore`) are eligible; each is claimed with its OWN
   *  conditional `updateMany` so a concurrent claimer racing the exact same row
   *  loses cleanly (`count === 0`) rather than both proceeding. */
  async claimBatch(
    organisationId: string,
    staleBefore: Date,
    limit: number,
  ): Promise<EmailDelivery[]> {
    const now = new Date();
    const candidates = await this.prisma.emailDelivery.findMany({
      where: {
        organisationId,
        OR: [
          { status: 'PENDING', OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }] },
          { status: 'PROCESSING', leaseAt: { lt: staleBefore } },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });

    const claimed: EmailDelivery[] = [];
    for (const candidate of candidates) {
      const result = await this.prisma.emailDelivery.updateMany({
        where: {
          id: candidate.id,
          OR: [{ status: 'PENDING' }, { status: 'PROCESSING', leaseAt: { lt: staleBefore } }],
        },
        data: { status: 'PROCESSING', leaseAt: now },
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
    const result = await this.prisma.emailDelivery.updateMany({
      where: { id, organisationId, status: 'PROCESSING' },
      data: {
        status: 'SENT',
        sentAt: new Date(),
        attempts: { increment: 1 },
        lastAttemptedAt: new Date(),
        providerName: data.providerName,
        providerMessageId: data.providerMessageId,
        lastErrorCategory: null,
        lastError: null,
        nextRetryAt: null,
        leaseAt: null,
      },
    });
    return result.count > 0;
  }

  /** Failure path — `terminal` (attempts exhausted, or a `TERMINAL_FAILURE`
   *  outcome) moves straight to `FAILED`; otherwise back to `PENDING` with a
   *  scheduled `nextRetryAt`. Bounded `errorMessage` (2000 chars, same convention
   *  as `WorkflowEvent.notificationLastError`, Sprint 27.1) — the caller
   *  (`EmailDeliveryProcessorService`) is responsible for never passing a raw
   *  provider exception through here. */
  async markFailed(
    organisationId: string,
    id: string,
    data: {
      terminal: boolean;
      providerName: string;
      errorCategory?: string;
      errorMessage?: string;
      nextRetryAt: Date | null;
    },
  ): Promise<boolean> {
    const result = await this.prisma.emailDelivery.updateMany({
      where: { id, organisationId, status: 'PROCESSING' },
      data: {
        status: data.terminal ? 'FAILED' : 'PENDING',
        attempts: { increment: 1 },
        lastAttemptedAt: new Date(),
        providerName: data.providerName,
        lastErrorCategory: data.errorCategory?.slice(0, 100),
        lastError: data.errorMessage?.slice(0, 2000),
        nextRetryAt: data.terminal ? null : data.nextRetryAt,
        leaseAt: null,
      },
    });
    return result.count > 0;
  }

  /** Stamps `firstAttemptedAt` the first time a row is claimed — kept as its own
   *  tiny conditional update (only fires when currently `null`) rather than
   *  folded into `claimBatch`, since it's a one-time stamp, not a repeatable
   *  transition. */
  async stampFirstAttempt(id: string): Promise<void> {
    await this.prisma.emailDelivery.updateMany({
      where: { id, firstAttemptedAt: null },
      data: { firstAttemptedAt: new Date() },
    });
  }

  /** Manual admin retry (Sprint 28 §Workstream G) — eligible from `FAILED` or a
   *  stuck `PROCESSING` row; bypasses backoff (`nextRetryAt = now`), does NOT
   *  reset `attempts` (full history preserved, same convention as the in-app
   *  processor's `retryEvent`, Sprint 27.1). */
  async manualRetry(organisationId: string, id: string): Promise<boolean> {
    const result = await this.prisma.emailDelivery.updateMany({
      where: { id, organisationId, status: { in: ['FAILED', 'PROCESSING'] } },
      data: { status: 'PENDING', nextRetryAt: new Date(), leaseAt: null },
    });
    return result.count > 0;
  }
}
