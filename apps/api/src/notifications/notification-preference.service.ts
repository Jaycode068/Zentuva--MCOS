import { BadRequestException, Injectable } from '@nestjs/common';
import { NotificationCategory } from '@prisma/client';

import { ALL_NOTIFICATION_CATEGORIES } from './notification-category';
import { NotificationPreferenceRepository } from './notification-preference.repository';

export interface PreferenceView {
  category: NotificationCategory;
  inAppEnabled: boolean;
}

/**
 * Sprint 27.1 §Workstream D "Notification Preferences Foundation" (notifications.md
 * §6). Deliberately NOT an authorization mechanism (§3.2) — this only answers "does
 * this user want an in-app row created for this category," never "is this user
 * allowed to." A missing preference row always means enabled (§7.3's explicit
 * default), so `getForUser` always returns one entry per category regardless of
 * what's actually stored, filling in the default for anything absent.
 */
@Injectable()
export class NotificationPreferenceService {
  constructor(private readonly repository: NotificationPreferenceRepository) {}

  async getForUser(organisationId: string, userId: string): Promise<PreferenceView[]> {
    const stored = await this.repository.findAllForUser(organisationId, userId);
    const byCategory = new Map(stored.map((p) => [p.category, p.inAppEnabled]));
    return ALL_NOTIFICATION_CATEGORIES.map((category) => ({
      category,
      inAppEnabled: byCategory.get(category) ?? true,
    }));
  }

  async update(
    organisationId: string,
    userId: string,
    category: NotificationCategory,
    inAppEnabled: boolean,
  ): Promise<PreferenceView> {
    if (!ALL_NOTIFICATION_CATEGORIES.includes(category)) {
      throw new BadRequestException(`"${category}" is not a supported notification category`);
    }
    const saved = await this.repository.upsert(organisationId, userId, category, inAppEnabled);
    return { category: saved.category, inAppEnabled: saved.inAppEnabled };
  }

  /** §7.3 "Reset to defaults if useful" — deletes every stored override, which
   *  is equivalent to "everything enabled" given `getForUser`'s own default-fill
   *  behavior; never deletes any `Notification` row already created. */
  async resetToDefaults(organisationId: string, userId: string): Promise<PreferenceView[]> {
    await this.repository.deleteAllForUser(organisationId, userId);
    return this.getForUser(organisationId, userId);
  }

  /** Used only by `NotificationEventProcessorService` — given a candidate
   *  recipient list and the category this event's notification would be, returns
   *  the subset who have NOT explicitly disabled it. Never touches
   *  `WorkflowEvent`/audit/Activity Centre; this is purely a Notification-
   *  creation-time filter (§Workstream D "suppression semantics": option 1,
   *  creation, not visibility or delivery). */
  async filterEnabledRecipients(
    organisationId: string,
    recipientUserIds: string[],
    category: NotificationCategory,
  ): Promise<string[]> {
    if (recipientUserIds.length === 0) return [];
    const preferences = await this.repository.findManyForUsers(
      organisationId,
      recipientUserIds,
      category,
    );
    const disabled = new Set(preferences.filter((p) => !p.inAppEnabled).map((p) => p.userId));
    return recipientUserIds.filter((id) => !disabled.has(id));
  }
}
