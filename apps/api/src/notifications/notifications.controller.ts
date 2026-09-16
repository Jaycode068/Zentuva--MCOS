import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { NotificationStatus } from '@prisma/client';
import { paginationSchema } from '@zentuva/validation';

import { CurrentUser } from '../identity/auth/decorators/current-user.decorator';
import { RequirePermission } from '../identity/auth/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../identity/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../identity/auth/guards/permissions.guard';
import { TokenPayload } from '../identity/auth/ports/token.port';
import { ActivityService } from './activity.service';
import { NotificationEventProcessorService } from './notification-event-processor.service';
import { NotificationService } from './notification.service';

/**
 * `/notifications` — the authenticated user's own in-app notifications
 * (docs/domains/notifications.md §8). `JwtAuthGuard` only, no `PermissionsGuard`/
 * `@RequirePermission` — matching `AccountController`'s existing precedent for
 * inherently self-scoped "my own data" endpoints: there is no meaningful permission
 * to gate "read your own notifications" behind beyond "is an authenticated, active
 * user," and every query is additionally scoped to the caller's own
 * `recipientUserId` server-side regardless (Sprint 27 rule "do not rely on frontend
 * filtering"). No new permission-catalogue entries were added for this controller —
 * see notifications.md §13.
 */
@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(
    private readonly notificationService: NotificationService,
    private readonly notificationEventProcessorService: NotificationEventProcessorService,
    private readonly activityService: ActivityService,
  ) {}

  /** Sprint 27 §Workstream 6 "Activity Centre Foundation" — organisation-wide, NOT
   *  recipient-scoped (unlike every other route on this controller), so it needs a
   *  real permission gate rather than "any authenticated user." Reuses
   *  `workflow.audit.view` (already gates `GET /workflows/instances/:id/history`) —
   *  no new permission-catalogue entry, matching the trust level of the data
   *  actually exposed (who did what to which workflow instance, org-wide). */
  @Get('activity')
  @UseGuards(PermissionsGuard)
  @RequirePermission('workflow.audit.view')
  async activity(
    @CurrentUser() user: TokenPayload,
    @Query('subjectType') subjectType?: string,
    @Query('subjectId') subjectId?: string,
    @Query('page') pageRaw?: string,
    @Query('pageSize') pageSizeRaw?: string,
  ) {
    const { page, pageSize } = paginationSchema.parse({ page: pageRaw, pageSize: pageSizeRaw });
    const { items, total } = await this.activityService.list(user.organisationId, {
      subjectType,
      subjectId,
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { items, total, page, pageSize };
  }

  @Get()
  async list(
    @CurrentUser() user: TokenPayload,
    @Query('status') status?: NotificationStatus,
    @Query('type') type?: string,
    @Query('page') pageRaw?: string,
    @Query('pageSize') pageSizeRaw?: string,
  ) {
    const { page, pageSize } = paginationSchema.parse({ page: pageRaw, pageSize: pageSizeRaw });
    return this.notificationService.list(user.organisationId, user.sub, {
      status,
      type,
      page,
      pageSize,
    });
  }

  @Get('unread-count')
  async unreadCount(@CurrentUser() user: TokenPayload) {
    const count = await this.notificationService.unreadCount(user.organisationId, user.sub);
    return { count };
  }

  /** Sprint 27 §Workstream 2 — no queue/cron/worker infrastructure exists anywhere
   *  in this codebase today (verified by inspection). Rather than adding one solely
   *  for this sprint, event→notification processing is triggered on demand: the
   *  frontend calls this right after a workflow-mutating action succeeds and on a
   *  periodic poll (see the web notification centre), and this sprint's live
   *  verification calls it directly. `JwtAuthGuard` only — any authenticated, active
   *  user may trigger "catch up on pending notification processing for MY
   *  organisation"; this creates no privilege escalation because the caller never
   *  chooses recipients or content — `NotificationEventProcessorService` derives
   *  both entirely server-side from the same eligibility rules Workflow itself
   *  enforces. A future scheduled job can call
   *  `NotificationEventProcessorService.processPendingEvents` directly and this
   *  endpoint can be removed or left as a manual "process now" affordance, without
   *  any change to the processing logic itself. */
  @Post('process-events')
  @HttpCode(HttpStatus.OK)
  processEvents(@CurrentUser() user: TokenPayload) {
    return this.notificationEventProcessorService.processPendingEvents(user.organisationId);
  }

  @Post('mark-all-read')
  @HttpCode(HttpStatus.OK)
  async markAllRead(@CurrentUser() user: TokenPayload) {
    const count = await this.notificationService.markAllRead(user.organisationId, user.sub);
    return { count };
  }

  @Get(':id')
  getById(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    return this.notificationService.getByIdOrThrow(user.organisationId, user.sub, id);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  async markRead(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    await this.notificationService.markRead(user.organisationId, user.sub, id);
    return { ok: true };
  }

  @Post(':id/unread')
  @HttpCode(HttpStatus.OK)
  async markUnread(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    await this.notificationService.markUnread(user.organisationId, user.sub, id);
    return { ok: true };
  }
}
