import { z } from 'zod';

/**
 * Sprint 27.1 — Notification Reliability & Preferences (docs/domains/
 * notifications.md §6). Following the exact `workflow.ts` one-shared-file-per-
 * domain convention: the server always takes `organisationId`/`userId` from the
 * caller's own token, never from the body — these schemas only validate the
 * category/value being written.
 */

export const notificationCategorySchema = z.enum(['WORKFLOW_APPROVALS', 'WORKFLOW_STATUS_CHANGES']);

/** Sprint 28 §Workstream B "Preference Model" — both fields optional so a save can
 *  update in-app OR email alone; `.refine` requires at least one, matching the
 *  service-layer check (`NotificationPreferenceService.update`). */
export const updateNotificationPreferenceSchema = z
  .object({
    inAppEnabled: z.boolean().optional(),
    emailEnabled: z.boolean().optional(),
  })
  .refine((v) => v.inAppEnabled !== undefined || v.emailEnabled !== undefined, {
    message: 'Provide at least one of inAppEnabled, emailEnabled',
  });
export type UpdateNotificationPreferenceInput = z.infer<typeof updateNotificationPreferenceSchema>;
