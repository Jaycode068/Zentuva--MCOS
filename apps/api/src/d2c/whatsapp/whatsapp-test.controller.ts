import { randomUUID } from 'node:crypto';

import { BadRequestException, Body, Controller, Inject, Post, UseGuards } from '@nestjs/common';
import {
  SendWhatsAppTestImageInput,
  SendWhatsAppTestTemplateInput,
  SendWhatsAppTestTextInput,
  sendWhatsAppTestImageSchema,
  sendWhatsAppTestTemplateSchema,
  sendWhatsAppTestTextSchema,
} from '@zentuva/validation';

import { AuditService } from '../../identity/audit/audit.service';
import { CurrentUser } from '../../identity/auth/decorators/current-user.decorator';
import { RequirePermission } from '../../identity/auth/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../../identity/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../identity/auth/guards/permissions.guard';
import { TokenPayload } from '../../identity/auth/ports/token.port';
import { normalizePhoneNumber } from '../../notifications/phone-number-normalizer';
import {
  WHATSAPP_PROVIDER,
  WhatsAppProvider,
} from '../../notifications/ports/whatsapp-provider.port';
import { OrganisationService } from '../../identity/organisation/organisation.service';
import { ZodValidationPipe } from '../../identity/auth/common/zod-validation.pipe';
import { WHATSAPP_AUDIT_ACTIONS } from './whatsapp-audit-actions';

/** The safe, bounded response shape every test-send route returns — "Do not expose
 *  tokens" (brief) — never the provider config, never a raw Meta response body. */
interface WhatsAppTestSendResponse {
  success: boolean;
  metaMessageId?: string;
  errorCode?: string;
}

/**
 * Sprint 40.5 — Real Meta WhatsApp Cloud API Foundation (docs/domains/whatsapp.md
 * "Admin Test Surface"). Route is the brief's own exact literal path — `POST
 * /api/whatsapp/test/{text,template,image}`. Admin-only, authenticated: reuses the
 * EXISTING `d2c.consumer.manage` permission rather than introducing a new one — the
 * same "driving WhatsApp sends is an administrative D2C capability, not a new trust
 * boundary" reasoning `ConversationController`'s own doc comment already establishes
 * for the identical internal-test-harness situation.
 *
 * Always sends through the SAME `WHATSAPP_PROVIDER` token every other caller in this
 * codebase uses — whichever `WHATSAPP_PROVIDER_MODE` currently selects (`local` in
 * dev, `meta` to prove a real send) — never a second, bypassing path straight to
 * `MetaWhatsAppProvider`.
 */
@Controller('whatsapp/test')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class WhatsAppTestController {
  constructor(
    @Inject(WHATSAPP_PROVIDER) private readonly provider: WhatsAppProvider,
    private readonly organisationService: OrganisationService,
    private readonly auditService: AuditService,
  ) {}

  @Post('text')
  @RequirePermission('d2c.consumer.manage')
  async sendText(
    @Body(new ZodValidationPipe(sendWhatsAppTestTextSchema)) body: SendWhatsAppTestTextInput,
    @CurrentUser() user: TokenPayload,
  ): Promise<WhatsAppTestSendResponse> {
    const toPhoneNumber = await this.normalizeOrThrow(user.organisationId, body.to);
    const correlationId = randomUUID();
    const result = await this.provider.sendText({ toPhoneNumber, text: body.text, correlationId });
    await this.audit(user, 'TEXT', result.outcome === 'ACCEPTED');
    return toResponse(result);
  }

  @Post('template')
  @RequirePermission('d2c.consumer.manage')
  async sendTemplate(
    @Body(new ZodValidationPipe(sendWhatsAppTestTemplateSchema))
    body: SendWhatsAppTestTemplateInput,
    @CurrentUser() user: TokenPayload,
  ): Promise<WhatsAppTestSendResponse> {
    const toPhoneNumber = await this.normalizeOrThrow(user.organisationId, body.to);
    const correlationId = randomUUID();
    const result = await this.provider.sendTemplate({
      toPhoneNumber,
      templateName: body.templateName,
      templateLanguage: body.languageCode,
      bodyParameters: body.bodyParameters,
      correlationId,
    });
    await this.audit(user, 'TEMPLATE', result.outcome === 'ACCEPTED');
    return toResponse(result);
  }

  @Post('image')
  @RequirePermission('d2c.consumer.manage')
  async sendImage(
    @Body(new ZodValidationPipe(sendWhatsAppTestImageSchema)) body: SendWhatsAppTestImageInput,
    @CurrentUser() user: TokenPayload,
  ): Promise<WhatsAppTestSendResponse> {
    const toPhoneNumber = await this.normalizeOrThrow(user.organisationId, body.to);
    const correlationId = randomUUID();
    const result = await this.provider.sendImage({
      toPhoneNumber,
      imageUrl: body.imageUrl,
      caption: body.caption,
      correlationId,
    });
    await this.audit(user, 'IMAGE', result.outcome === 'ACCEPTED');
    return toResponse(result);
  }

  /** The admin-entered recipient is a raw string — normalized through the SAME
   *  `normalizePhoneNumber` every other WhatsApp send path in this codebase uses,
   *  never a bespoke second parser. */
  private async normalizeOrThrow(organisationId: string, rawPhoneNumber: string): Promise<string> {
    const organisation = await this.organisationService.getById(organisationId);
    const { normalized, reason } = normalizePhoneNumber(rawPhoneNumber, organisation?.country);
    if (!normalized) {
      throw new BadRequestException(reason ?? 'Recipient phone number could not be normalized');
    }
    return normalized;
  }

  private async audit(user: TokenPayload, kind: string, success: boolean): Promise<void> {
    await this.auditService.record({
      action: WHATSAPP_AUDIT_ACTIONS.TEST_MESSAGE_SENT,
      entityType: 'WhatsAppTestMessage',
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { kind, success },
    });
  }
}

function toResponse(result: {
  outcome: string;
  providerMessageId?: string;
  errorCode?: string;
}): WhatsAppTestSendResponse {
  return {
    success: result.outcome === 'ACCEPTED',
    metaMessageId: result.providerMessageId,
    errorCode: result.errorCode,
  };
}
