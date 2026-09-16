import { Injectable, NotFoundException } from '@nestjs/common';
import { NotificationStatus } from '@prisma/client';

import { ListNotificationsParams, NotificationRepository } from './notification.repository';

export interface ListNotificationsResult {
  items: Awaited<ReturnType<NotificationRepository['findManyForRecipient']>>;
  total: number;
  page: number;
  pageSize: number;
}

/**
 * `GET/POST /notifications/*` — the authenticated user's own notifications only
 * (docs/domains/notifications.md §8). Every method takes `organisationId` +
 * `recipientUserId` from the caller's own token (`TokenPayload`, never a client-
 * supplied user id) and passes both straight through to `NotificationRepository`,
 * whose every query already scopes by both — there is no code path here that can
 * read or mutate another user's or another organisation's notification.
 */
@Injectable()
export class NotificationService {
  constructor(private readonly notificationRepository: NotificationRepository) {}

  async list(
    organisationId: string,
    recipientUserId: string,
    params: { status?: NotificationStatus; type?: string; page: number; pageSize: number },
  ): Promise<ListNotificationsResult> {
    const listParams: ListNotificationsParams = {
      status: params.status,
      type: params.type,
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
    };
    const [items, total] = await Promise.all([
      this.notificationRepository.findManyForRecipient(organisationId, recipientUserId, listParams),
      this.notificationRepository.countForRecipient(organisationId, recipientUserId, params),
    ]);
    return { items, total, page: params.page, pageSize: params.pageSize };
  }

  async getByIdOrThrow(organisationId: string, recipientUserId: string, id: string) {
    const notification = await this.notificationRepository.findByIdForRecipient(
      organisationId,
      recipientUserId,
      id,
    );
    if (!notification) {
      throw new NotFoundException('Notification not found');
    }
    return notification;
  }

  unreadCount(organisationId: string, recipientUserId: string): Promise<number> {
    return this.notificationRepository.countUnreadForRecipient(organisationId, recipientUserId);
  }

  /** Idempotent: marking an already-`READ` notification read again is a harmless
   *  no-op, never an error — the caller (a UI double-click, a retried request) can't
   *  tell the difference between "just marked it" and "it was already read." */
  async markRead(organisationId: string, recipientUserId: string, id: string): Promise<void> {
    await this.getByIdOrThrow(organisationId, recipientUserId, id);
    await this.notificationRepository.markRead(organisationId, recipientUserId, id);
  }

  async markUnread(organisationId: string, recipientUserId: string, id: string): Promise<void> {
    await this.getByIdOrThrow(organisationId, recipientUserId, id);
    await this.notificationRepository.markUnread(organisationId, recipientUserId, id);
  }

  markAllRead(organisationId: string, recipientUserId: string): Promise<number> {
    return this.notificationRepository.markAllRead(organisationId, recipientUserId);
  }
}
