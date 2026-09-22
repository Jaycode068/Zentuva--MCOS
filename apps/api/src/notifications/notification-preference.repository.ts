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
   *  request body. `patch` is partial so a save can update any subset of
   *  `inAppEnabled`/`emailEnabled`/`whatsappEnabled` — any field NOT supplied
   *  on a fresh `create` falls through to the column's own schema default
   *  (`inAppEnabled` → `true`, `emailEnabled`/`whatsappEnabled` → `false`),
   *  never hand-duplicated here. */
  upsert(
    organisationId: string,
    userId: string,
    category: NotificationCategory,
    patch: { inAppEnabled?: boolean; emailEnabled?: boolean; whatsappEnabled?: boolean },
  ): Promise<NotificationPreference> {
    return this.prisma.notificationPreference.upsert({
      where: { organisationId_userId_category: { organisationId, userId, category } },
      create: { organisationId, userId, category, ...patch },
      update: { ...patch },
    });
  }

  deleteAllForUser(organisationId: string, userId: string): Promise<{ count: number }> {
    return this.prisma.notificationPreference.deleteMany({ where: { organisationId, userId } });
  }

  /** Bulk-fetch for the processor's own preference-filtering step (§Workstream D)
   *  — one query per event, not one per recipient. Reused as-is by Sprint 28's
   *  `EmailEligibilityService` (it needs the SAME rows, just reads `emailEnabled`
   *  off them instead of `inAppEnabled`). */
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

  /** Sprint 28 — single-row lookup for `EmailEligibilityService`, which evaluates
   *  one already-created `Notification`'s one recipient at a time (unlike the
   *  in-app processor's batch-of-candidates shape above). `null` means "no
   *  stored row" — the caller applies the default (`emailEnabled` → `false`). */
  findOne(
    organisationId: string,
    userId: string,
    category: NotificationCategory,
  ): Promise<NotificationPreference | null> {
    return this.prisma.notificationPreference.findUnique({
      where: { organisationId_userId_category: { organisationId, userId, category } },
    });
  }
}
