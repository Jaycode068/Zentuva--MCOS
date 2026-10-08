import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { paginationSchema } from '@zentuva/validation';

import { CurrentUser } from '../../identity/auth/decorators/current-user.decorator';
import { RequirePermission } from '../../identity/auth/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../../identity/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../identity/auth/guards/permissions.guard';
import { TokenPayload } from '../../identity/auth/ports/token.port';
import { ConsumerCommunicationService } from './consumer-communication.service';

/**
 * Sprint 43 — D2C Operations, Notifications & Production Hardening HTTP surface
 * (docs/domains/d2c.md "Consumer Communication Delivery Visibility"). Every route
 * additionally re-asserts the holder's grant inside `ConsumerCommunicationService` (the
 * same defense-in-depth shape every other D2C admin controller already uses) — the
 * `@RequirePermission` decorators below only establish that the caller holds the right
 * KIND of permission at all.
 */
@Controller('d2c/communications')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ConsumerCommunicationController {
  constructor(private readonly service: ConsumerCommunicationService) {}

  @Get('by-consumer/:consumerId')
  @RequirePermission('d2c.communication.view')
  async listForConsumer(
    @CurrentUser() user: TokenPayload,
    @Param('consumerId') consumerId: string,
    @Query('page') pageRaw?: string,
    @Query('pageSize') pageSizeRaw?: string,
  ) {
    const { page, pageSize } = paginationSchema.parse({ page: pageRaw, pageSize: pageSizeRaw });
    const { items, total } = await this.service.listForConsumer(
      user.organisationId,
      user.sub,
      consumerId,
      { page, pageSize },
    );
    return { items, total, page, pageSize };
  }

  @Get('by-order/:salesOrderId')
  @RequirePermission('d2c.communication.view')
  async listForOrder(
    @CurrentUser() user: TokenPayload,
    @Param('salesOrderId') salesOrderId: string,
  ) {
    const items = await this.service.listForOrder(user.organisationId, user.sub, salesOrderId);
    return { items };
  }

  @Get('by-conversation/:conversationId')
  @RequirePermission('d2c.communication.view')
  async listForConversation(
    @CurrentUser() user: TokenPayload,
    @Param('conversationId') conversationId: string,
  ) {
    const items = await this.service.listForConversation(
      user.organisationId,
      user.sub,
      conversationId,
    );
    return { items };
  }

  @Post(':id/retry')
  @RequirePermission('d2c.communication.manage')
  async retry(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    return this.service.retry(user.organisationId, user.sub, id);
  }
}
