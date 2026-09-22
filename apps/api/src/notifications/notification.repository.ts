import { Injectable } from '@nestjs/common';
import { Notification, NotificationStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

export interface ListNotificationsParams {
  status?: NotificationStatus;
  type?: string;
  skip?: number;
  take?: number;
}

/**
 * Thin Prisma access for `Notification` — no business logic (matches this codebase's
 * repository convention throughout Workflow/Access Control/HR). Every method that
 * reads or writes a specific notification takes `organisationId` AND
 * `recipientUserId` in its `WHERE` clause, never `id` alone — Sprint 27's tenant- and
 * recipient-isolation guarantee is enforced here, not layered on afterward
 * (docs/domains/notifications.md §8).
 */
@Injectable()
export class NotificationRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Sprint 27 §3 "Idempotency and Deduplication" — `skipDuplicates: true` against
   *  the `(organisationId, sourceEventId, recipientUserId, channel)` unique index is
   *  the actual concurrency guarantee; this is a plain batch insert with no
   *  additional application-level duplicate check, by design (the DB constraint is
   *  authoritative, not a backstop for one). */
  createMany(data: Prisma.NotificationCreateManyInput[]): Promise<Prisma.BatchPayload> {
    return this.prisma.notification.createMany({ data, skipDuplicates: true });
  }

  findByIdForRecipient(
    organisationId: string,
    recipientUserId: string,
    id: string,
  ): Promise<Notification | null> {
    return this.prisma.notification.findFirst({
      where: { id, organisationId, recipientUserId },
    });
  }

  findManyForRecipient(
    organisationId: string,
    recipientUserId: string,
    params: ListNotificationsParams = {},
  ): Promise<Notification[]> {
    return this.prisma.notification.findMany({
      where: {
        organisationId,
        recipientUserId,
        ...(params.status ? { status: params.status } : {}),
        ...(params.type ? { type: params.type as Notification['type'] } : {}),
      },
      orderBy: { createdAt: 'desc' },
      skip: params.skip,
      take: params.take,
    });
  }

  countForRecipient(
    organisationId: string,
    recipientUserId: string,
    params: Pick<ListNotificationsParams, 'status' | 'type'> = {},
  ): Promise<number> {
    return this.prisma.notification.count({
      where: {
        organisationId,
        recipientUserId,
        ...(params.status ? { status: params.status } : {}),
        ...(params.type ? { type: params.type as Notification['type'] } : {}),
      },
    });
  }

  countUnreadForRecipient(organisationId: string, recipientUserId: string): Promise<number> {
    return this.prisma.notification.count({
      where: { organisationId, recipientUserId, status: 'UNREAD' },
    });
  }

  /** Conditional on the row still being `UNREAD` — idempotent-safe: a repeated
   *  mark-read call on an already-`READ` notification simply returns `false`
   *  (nothing to do), never a second `readAt` write or an error. */
  async markRead(organisationId: string, recipientUserId: string, id: string): Promise<boolean> {
    const result = await this.prisma.notification.updateMany({
      where: { id, organisationId, recipientUserId, status: 'UNREAD' },
      data: { status: 'READ', readAt: new Date() },
    });
    return result.count > 0;
  }

  async markUnread(organisationId: string, recipientUserId: string, id: string): Promise<boolean> {
    const result = await this.prisma.notification.updateMany({
      where: { id, organisationId, recipientUserId, status: 'READ' },
      data: { status: 'UNREAD', readAt: null },
    });
    return result.count > 0;
  }

  /** Returns the number actually flipped — always safe to repeat (a second call
   *  right after the first affects zero rows, not an error). */
  async markAllRead(organisationId: string, recipientUserId: string): Promise<number> {
    const result = await this.prisma.notification.updateMany({
      where: { organisationId, recipientUserId, status: 'UNREAD' },
      data: { status: 'READ', readAt: new Date() },
    });
    return result.count;
  }

  /** Sprint 28 — notifications for this organisation with no `EmailDelivery` row
   *  yet (`{ emailDeliveries: { none: {} } }`, a genuine `NOT EXISTS`, not a
   *  client-side join). Used by
   *  `EmailDeliveryCreationService.createPendingDeliveries`, bounded by `limit`.
   *
   *  NEWEST-first, deliberately NOT the oldest-first order every other sweep in
   *  this domain uses — found live, during this sprint's own verification: a
   *  notification evaluated and found INELIGIBLE for email never gets an
   *  `EmailDelivery` row (there's nothing to create), so it keeps matching this
   *  query on every future sweep forever. With oldest-first ordering, a backlog
   *  of old ineligible notifications permanently occupies the entire `limit`
   *  window, starving genuinely eligible NEW notifications from ever being
   *  reached — reproduced live in this sprint's verification (a freshly
   *  submitted, fully-eligible notification was silently never emailed behind
   *  ~50 old ineligible ones). Newest-first means a live system's actionable
   *  backlog is always reachable regardless of how large the old, permanently-
   *  ineligible tail grows; those old rows simply never matter rather than
   *  actively blocking anything. */
  findPendingForEmailEvaluation(organisationId: string, limit: number): Promise<Notification[]> {
    return this.prisma.notification.findMany({
      where: { organisationId, emailDeliveries: { none: {} } },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /** Sprint 29 — the WhatsApp equivalent of `findPendingForEmailEvaluation`.
   *  NEWEST-first from the start (never oldest-first) — Sprint 28 found live
   *  that oldest-first ordering lets a backlog of permanently-ineligible old
   *  notifications starve genuinely eligible new ones out of the scan window
   *  forever, since an ineligible notification never gets a delivery row and
   *  so never leaves this query's result set (notifications.md §15.6). */
  findPendingForWhatsAppEvaluation(organisationId: string, limit: number): Promise<Notification[]> {
    return this.prisma.notification.findMany({
      where: { organisationId, whatsappDeliveries: { none: {} } },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}
