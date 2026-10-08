import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import {
  UpdateD2CConversationCapabilitiesInput,
  UpdateD2CConversationMessageInput,
  UpdateD2CConversationProfileInput,
  updateD2CConversationCapabilitiesSchema,
  updateD2CConversationMessageSchema,
  updateD2CConversationProfileSchema,
} from '@zentuva/validation';
import { D2CConversationMessageKey } from '@prisma/client';

import { ZodValidationPipe } from '../../identity/auth/common/zod-validation.pipe';
import { CurrentUser } from '../../identity/auth/decorators/current-user.decorator';
import { RequirePermission } from '../../identity/auth/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../../identity/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../identity/auth/guards/permissions.guard';
import { TokenPayload } from '../../identity/auth/ports/token.port';
import { D2CConversationConfigService } from './d2c-conversation-config.service';

/**
 * Sprint 44 — Tenant D2C Conversation Configuration (docs/domains/d2c.md "Tenant
 * Conversation Configuration"). Internal/authenticated admin surface — `organisationId`
 * is ALWAYS taken from the caller's own authenticated session, never accepted in any
 * request body/param (brief §Phase 18/20 "never trust tenant/organisation IDs supplied
 * by the client"). Every route re-asserts the holder's grant inside
 * `D2CConversationConfigService` too (the same defense-in-depth shape every other D2C
 * admin controller already uses) — `@RequirePermission` here only establishes the
 * caller holds the right KIND of permission at all.
 */
@Controller('d2c/conversation-config')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class D2CConversationConfigController {
  constructor(private readonly service: D2CConversationConfigService) {}

  @Get()
  @RequirePermission('d2c.conversation.view')
  async getConfig(@CurrentUser() user: TokenPayload) {
    return this.service.getAdminView(user.organisationId, user.sub);
  }

  @Get('preview')
  @RequirePermission('d2c.conversation.view')
  async getPreview(@CurrentUser() user: TokenPayload) {
    return this.service.getPreview(user.organisationId, user.sub);
  }

  @Put('profile')
  @RequirePermission('d2c.conversation.manage')
  async updateProfile(
    @CurrentUser() user: TokenPayload,
    @Body(new ZodValidationPipe(updateD2CConversationProfileSchema))
    body: UpdateD2CConversationProfileInput,
  ) {
    await this.service.updateProfile(user.organisationId, user.sub, body);
    return this.service.getAdminView(user.organisationId, user.sub);
  }

  @Put('capabilities')
  @RequirePermission('d2c.conversation.manage')
  async updateCapabilities(
    @CurrentUser() user: TokenPayload,
    @Body(new ZodValidationPipe(updateD2CConversationCapabilitiesSchema))
    body: UpdateD2CConversationCapabilitiesInput,
  ) {
    await this.service.updateCapabilities(user.organisationId, user.sub, body.capabilities);
    return this.service.getAdminView(user.organisationId, user.sub);
  }

  @Put('messages/:messageKey')
  @RequirePermission('d2c.conversation.manage')
  async updateMessage(
    @CurrentUser() user: TokenPayload,
    @Param('messageKey') messageKey: D2CConversationMessageKey,
    @Body(new ZodValidationPipe(updateD2CConversationMessageSchema))
    body: UpdateD2CConversationMessageInput,
  ) {
    await this.service.updateMessage(user.organisationId, user.sub, messageKey, body.value);
    return this.service.getAdminView(user.organisationId, user.sub);
  }

  @Put('messages/:messageKey/reset')
  @RequirePermission('d2c.conversation.manage')
  async resetMessage(
    @CurrentUser() user: TokenPayload,
    @Param('messageKey') messageKey: D2CConversationMessageKey,
  ) {
    await this.service.resetMessageToDefault(user.organisationId, user.sub, messageKey);
    return this.service.getAdminView(user.organisationId, user.sub);
  }
}
