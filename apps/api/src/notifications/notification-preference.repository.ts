import { Injectable } from '@nestjs/common';
import { NotificationCategory, NotificationPreference } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

/** Thin Prisma access for `NotificationPreference` — no business logic (default
 *  resolution lives in `NotificationPreferenceService`, matching this codebase's
 *  repository/service split throughout). */
@Injectable()
export class NotificationPreferenceRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAllForUser(organisationId: string, userId: string): Promise<NotificationPreference[]> {
    return this.prisma.notificationPreference.findMany({
      where: { organisationId, userId },
    });
  }

  /** Upsert, scoped to exactly this tenant+user+category via the unique
   *  constraint — a client can never write another user's or tenant's row
   *  because both are always taken from the caller's own token, never the
   *  request body. */
  upsert(
    organisationId: string,
    userId: string,
    category: NotificationCategory,
    inAppEnabled: boolean,
  ): Promise<NotificationPreference> {
    return this.prisma.notificationPreference.upsert({
      where: { organisationId_userId_category: { organisationId, userId, category } },
      create: { organisationId, userId, category, inAppEnabled },
      update: { inAppEnabled },
    });
  }

  deleteAllForUser(organisationId: string, userId: string): Promise<{ count: number }> {
    return this.prisma.notificationPreference.deleteMany({ where: { organisationId, userId } });
  }

  /** Bulk-fetch for the processor's own preference-filtering step (§Workstream D)
   *  — one query per event, not one per recipient. */
  findManyForUsers(
    organisationId: string,
    userIds: string[],
    category: NotificationCategory,
  ): Promise<NotificationPreference[]> {
    if (userIds.length === 0) return Promise.resolve([]);
    return this.prisma.notificationPreference.findMany({
      where: { organisationId, userId: { in: userIds }, category },
    });
  }
}
