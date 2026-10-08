import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { D2CConversationCapability, D2CConversationMessageKey } from '@prisma/client';

import { AuditService } from '../../identity/audit/audit.service';
import { EffectiveAccessResolver } from '../../identity/authorization/effective-access-resolver';
import { OrganisationService } from '../../identity/organisation/organisation.service';
import { PrismaService } from '../../prisma/prisma.service';
import { D2C_CONVERSATION_CONFIG_AUDIT_ACTIONS } from './d2c-conversation-config-audit-actions';
import { buildMainMenuMessages, buildWelcomeMessage } from './d2c-conversation-config-rendering';
import { D2CConversationCapabilityRepository } from './d2c-conversation-capability.repository';
import { D2CConversationMessageRepository } from './d2c-conversation-message.repository';
import { D2CConversationProfileRepository } from './d2c-conversation-profile.repository';
import {
  ALL_CAPABILITIES,
  ALL_MESSAGE_KEYS,
  DEFAULT_CAPABILITY_ENABLED,
  DEFAULT_CAPABILITY_LABELS,
  DEFAULT_CAPABILITY_ORDER,
  DEFAULT_MESSAGES,
  EffectiveConversationConfig,
  MESSAGE_VARIABLE_ALLOWLIST,
} from './d2c-conversation-config.types';

const D2C_CONVERSATION_VIEW = 'd2c.conversation.view';
const D2C_CONVERSATION_MANAGE = 'd2c.conversation.manage';

const MAX_MESSAGE_LENGTH = 1000;
const MAX_LABEL_LENGTH = 60;

export interface CapabilityConfigInput {
  capability: D2CConversationCapability;
  enabled: boolean;
  /** `null`/omitted = use the platform default label. */
  displayLabel?: string | null;
  sortOrder: number;
}

/** The admin-facing read shape — distinguishes a tenant override from the platform
 *  default explicitly (brief §Phase 11 "Show whether a value is tenant-customized or
 *  using platform default"), which {@link EffectiveConversationConfig} deliberately does
 *  NOT do (it only ever exposes the single resolved value `ConversationService` uses). */
export interface D2CConversationConfigAdminView {
  organisationId: string;
  businessName: string;
  supportPhone: { value: string | null; isCustomized: boolean };
  supportEmail: { value: string | null; isCustomized: boolean };
  capabilities: {
    capability: D2CConversationCapability;
    enabled: boolean;
    displayLabel: string;
    isLabelCustomized: boolean;
    sortOrder: number;
  }[];
  messages: {
    messageKey: D2CConversationMessageKey;
    value: string;
    defaultValue: string;
    isCustomized: boolean;
    allowedVariables: string[];
  }[];
}

/**
 * Sprint 44 — Tenant D2C Conversation Configuration (docs/domains/d2c.md "Tenant
 * Conversation Configuration"). The ONE place tenant D2C conversation configuration is
 * resolved, read, and written — `ConversationService`/`CollectionPointFulfillmentService`
 * only ever call {@link resolveEffectiveConfig}, never query these tables directly
 * (brief §Phase 15 "ConversationService should not contain database
 * configuration-fetching logic everywhere").
 *
 * `resolveEffectiveConfig` deliberately has NO permission check — it is the
 * business-logic read path every real conversation turn calls, scoped only by the
 * `organisationId` its own caller already resolved server-side (never client-supplied,
 * brief §Phase 18/20). The admin read/write methods below (`getAdminView`,
 * `updateProfile`, `updateCapabilities`, `updateMessage`, `resetMessageToDefault`) DO
 * check permissions — they are the operator-facing surface, distinct from the
 * business-logic read.
 */
@Injectable()
export class D2CConversationConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly capabilityRepository: D2CConversationCapabilityRepository,
    private readonly messageRepository: D2CConversationMessageRepository,
    private readonly profileRepository: D2CConversationProfileRepository,
    private readonly organisationService: OrganisationService,
    private readonly effectiveAccessResolver: EffectiveAccessResolver,
    private readonly auditService: AuditService,
  ) {}

  // -----------------------------------------------------------------------
  // Business-logic read — no permission check, always re-derived server-side
  // -----------------------------------------------------------------------

  async resolveEffectiveConfig(organisationId: string): Promise<EffectiveConversationConfig> {
    const [organisation, profile, capabilityRows, messageRows] = await Promise.all([
      this.organisationService.getById(organisationId),
      this.profileRepository.findByOrganisation(organisationId),
      this.capabilityRepository.findManyByOrganisation(organisationId),
      this.messageRepository.findManyByOrganisation(organisationId),
    ]);

    const businessName = organisation?.displayName ?? organisation?.name ?? 'us';
    const supportPhone = profile?.supportPhoneOverride ?? organisation?.phone ?? null;
    const supportEmail = profile?.supportEmailOverride ?? organisation?.supportEmail ?? null;

    const capabilityByKey = new Map(capabilityRows.map((row) => [row.capability, row]));
    const capabilities = ALL_CAPABILITIES.map((capability) => {
      const row = capabilityByKey.get(capability);
      return {
        capability,
        enabled: row?.enabled ?? DEFAULT_CAPABILITY_ENABLED[capability],
        displayLabel: row?.displayLabel ?? DEFAULT_CAPABILITY_LABELS[capability],
        sortOrder: row?.sortOrder ?? DEFAULT_CAPABILITY_ORDER.indexOf(capability),
      };
    });

    const messageByKey = new Map(messageRows.map((row) => [row.messageKey, row.value]));
    const messages = Object.fromEntries(
      ALL_MESSAGE_KEYS.map((key) => [key, messageByKey.get(key) ?? DEFAULT_MESSAGES[key]]),
    ) as Record<D2CConversationMessageKey, string>;

    return { organisationId, businessName, supportPhone, supportEmail, capabilities, messages };
  }

  // -----------------------------------------------------------------------
  // Admin read
  // -----------------------------------------------------------------------

  async getAdminView(
    organisationId: string,
    actorUserId: string,
  ): Promise<D2CConversationConfigAdminView> {
    await this.assertView(organisationId, actorUserId);
    const [organisation, profile, capabilityRows, messageRows] = await Promise.all([
      this.organisationService.getById(organisationId),
      this.profileRepository.findByOrganisation(organisationId),
      this.capabilityRepository.findManyByOrganisation(organisationId),
      this.messageRepository.findManyByOrganisation(organisationId),
    ]);

    const capabilityByKey = new Map(capabilityRows.map((row) => [row.capability, row]));
    const messageByKey = new Map(messageRows.map((row) => [row.messageKey, row.value]));

    return {
      organisationId,
      businessName: organisation?.displayName ?? organisation?.name ?? 'us',
      supportPhone: {
        value: profile?.supportPhoneOverride ?? organisation?.phone ?? null,
        isCustomized: !!profile?.supportPhoneOverride,
      },
      supportEmail: {
        value: profile?.supportEmailOverride ?? organisation?.supportEmail ?? null,
        isCustomized: !!profile?.supportEmailOverride,
      },
      capabilities: ALL_CAPABILITIES.map((capability) => {
        const row = capabilityByKey.get(capability);
        return {
          capability,
          enabled: row?.enabled ?? DEFAULT_CAPABILITY_ENABLED[capability],
          displayLabel: row?.displayLabel ?? DEFAULT_CAPABILITY_LABELS[capability],
          isLabelCustomized: !!row?.displayLabel,
          sortOrder: row?.sortOrder ?? DEFAULT_CAPABILITY_ORDER.indexOf(capability),
        };
      }),
      messages: ALL_MESSAGE_KEYS.map((messageKey) => ({
        messageKey,
        value: messageByKey.get(messageKey) ?? DEFAULT_MESSAGES[messageKey],
        defaultValue: DEFAULT_MESSAGES[messageKey],
        isCustomized: messageByKey.has(messageKey),
        allowedVariables: MESSAGE_VARIABLE_ALLOWLIST[messageKey],
      })),
    };
  }

  /** Brief §Phase 14/30 — the preview IS the real resolver plus the real rendering
   *  functions, nothing else; it can never show the admin something the real
   *  conversation wouldn't actually send. */
  async getPreview(organisationId: string, actorUserId: string) {
    await this.assertView(organisationId, actorUserId);
    const config = await this.resolveEffectiveConfig(organisationId);
    return {
      messages: [buildWelcomeMessage(config), ...buildMainMenuMessages(config)],
    };
  }

  // -----------------------------------------------------------------------
  // Admin writes — permission-checked, validated, audited
  // -----------------------------------------------------------------------

  async updateProfile(
    organisationId: string,
    actorUserId: string,
    input: { supportPhone?: string | null; supportEmail?: string | null },
  ): Promise<void> {
    await this.assertManage(organisationId, actorUserId);
    if (input.supportPhone !== undefined && input.supportPhone !== null) {
      this.assertValidPhone(input.supportPhone);
    }
    if (input.supportEmail !== undefined && input.supportEmail !== null) {
      this.assertValidEmail(input.supportEmail);
    }

    const before = await this.profileRepository.findByOrganisation(organisationId);
    const next = {
      supportPhoneOverride:
        input.supportPhone !== undefined
          ? input.supportPhone
          : (before?.supportPhoneOverride ?? null),
      supportEmailOverride:
        input.supportEmail !== undefined
          ? input.supportEmail
          : (before?.supportEmailOverride ?? null),
    };
    await this.profileRepository.upsert(organisationId, next);

    await this.auditService.record({
      action: D2C_CONVERSATION_CONFIG_AUDIT_ACTIONS.PROFILE_UPDATED,
      entityType: 'D2CConversationProfile',
      entityId: organisationId,
      organisationId,
      actorUserId,
      metadata: {
        supportPhone: { old: before?.supportPhoneOverride ?? null, new: next.supportPhoneOverride },
        supportEmail: { old: before?.supportEmailOverride ?? null, new: next.supportEmailOverride },
      },
    });
  }

  /**
   * Brief §Phase 12 — always receives the FULL desired capability set (never a partial
   * patch of one row), validated as a whole before anything is written: no duplicate
   * capability, no duplicate `sortOrder`, no unsupported capability value (the Zod/Nest
   * pipe already rejects a non-enum value before this method is ever called, but an
   * explicit re-check here costs nothing and never trusts the transport layer alone),
   * label length bounded. All rows are written inside one `$transaction` — a validation
   * failure or a mid-save error never leaves a half-updated menu (brief §Phase 5
   * "partially saved configuration must not result in invalid conversation state").
   */
  async updateCapabilities(
    organisationId: string,
    actorUserId: string,
    inputs: CapabilityConfigInput[],
  ): Promise<void> {
    await this.assertManage(organisationId, actorUserId);
    this.assertValidCapabilitySet(inputs);

    const before = await this.capabilityRepository.findManyByOrganisation(organisationId);
    const beforeByKey = new Map(before.map((row) => [row.capability, row]));

    await this.prisma.$transaction(
      inputs.map((input) =>
        this.prisma.d2CConversationCapabilityConfig.upsert({
          where: { organisationId_capability: { organisationId, capability: input.capability } },
          create: {
            organisationId,
            capability: input.capability,
            enabled: input.enabled,
            displayLabel: input.displayLabel ?? null,
            sortOrder: input.sortOrder,
          },
          update: {
            enabled: input.enabled,
            displayLabel: input.displayLabel ?? null,
            sortOrder: input.sortOrder,
          },
        }),
      ),
    );

    await this.auditService.record({
      action: D2C_CONVERSATION_CONFIG_AUDIT_ACTIONS.CAPABILITIES_UPDATED,
      entityType: 'D2CConversationCapabilityConfig',
      entityId: organisationId,
      organisationId,
      actorUserId,
      metadata: {
        changes: inputs.map((input) => {
          const prior = beforeByKey.get(input.capability);
          return {
            capability: input.capability,
            enabled: {
              old: prior?.enabled ?? DEFAULT_CAPABILITY_ENABLED[input.capability],
              new: input.enabled,
            },
            displayLabel: { old: prior?.displayLabel ?? null, new: input.displayLabel ?? null },
            sortOrder: { old: prior?.sortOrder ?? null, new: input.sortOrder },
          };
        }),
      },
    });
  }

  async updateMessage(
    organisationId: string,
    actorUserId: string,
    messageKey: D2CConversationMessageKey,
    value: string,
  ): Promise<void> {
    await this.assertManage(organisationId, actorUserId);
    this.assertValidMessageValue(messageKey, value);

    const before = await this.messageRepository.findManyByOrganisation(organisationId);
    const priorValue =
      before.find((row) => row.messageKey === messageKey)?.value ?? DEFAULT_MESSAGES[messageKey];

    await this.messageRepository.upsert(organisationId, messageKey, value);

    await this.auditService.record({
      action: D2C_CONVERSATION_CONFIG_AUDIT_ACTIONS.MESSAGE_UPDATED,
      entityType: 'D2CConversationMessageConfig',
      entityId: `${organisationId}:${messageKey}`,
      organisationId,
      actorUserId,
      metadata: { messageKey, old: priorValue, new: value },
    });
  }

  async resetMessageToDefault(
    organisationId: string,
    actorUserId: string,
    messageKey: D2CConversationMessageKey,
  ): Promise<void> {
    await this.assertManage(organisationId, actorUserId);
    await this.messageRepository.delete(organisationId, messageKey);

    await this.auditService.record({
      action: D2C_CONVERSATION_CONFIG_AUDIT_ACTIONS.MESSAGE_RESET,
      entityType: 'D2CConversationMessageConfig',
      entityId: `${organisationId}:${messageKey}`,
      organisationId,
      actorUserId,
      metadata: { messageKey },
    });
  }

  // -----------------------------------------------------------------------
  // Validation (brief §Phase 25 — always server-side, frontend validation is
  // supplementary only)
  // -----------------------------------------------------------------------

  private assertValidCapabilitySet(inputs: CapabilityConfigInput[]): void {
    if (inputs.length === 0) {
      throw new BadRequestException('At least one capability configuration is required.');
    }
    const seenCapabilities = new Set<string>();
    const seenOrders = new Set<number>();
    let enabledCount = 0;
    for (const input of inputs) {
      if (!ALL_CAPABILITIES.includes(input.capability)) {
        throw new BadRequestException(`Unsupported capability: ${input.capability}`);
      }
      if (seenCapabilities.has(input.capability)) {
        throw new BadRequestException(`Duplicate capability: ${input.capability}`);
      }
      seenCapabilities.add(input.capability);
      if (seenOrders.has(input.sortOrder)) {
        throw new BadRequestException(`Duplicate menu position: ${input.sortOrder}`);
      }
      seenOrders.add(input.sortOrder);
      if (!Number.isInteger(input.sortOrder) || input.sortOrder < 1) {
        throw new BadRequestException('Menu position must be a positive integer.');
      }
      if (input.displayLabel != null) {
        const trimmed = input.displayLabel.trim();
        if (trimmed.length === 0) {
          throw new BadRequestException(
            'A capability label cannot be blank — leave it unset to use the platform default.',
          );
        }
        if (trimmed.length > MAX_LABEL_LENGTH) {
          throw new BadRequestException(
            `A capability label cannot exceed ${MAX_LABEL_LENGTH} characters.`,
          );
        }
      }
      if (input.enabled) enabledCount += 1;
    }
    if (enabledCount === 0) {
      throw new BadRequestException('At least one capability must remain enabled.');
    }
  }

  private assertValidMessageValue(messageKey: D2CConversationMessageKey, value: string): void {
    if (!ALL_MESSAGE_KEYS.includes(messageKey)) {
      throw new BadRequestException(`Unsupported message key: ${messageKey}`);
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      throw new BadRequestException('A message cannot be blank — use reset-to-default instead.');
    }
    if (trimmed.length > MAX_MESSAGE_LENGTH) {
      throw new BadRequestException(`A message cannot exceed ${MAX_MESSAGE_LENGTH} characters.`);
    }
    const allowed = new Set(MESSAGE_VARIABLE_ALLOWLIST[messageKey]);
    const usedVariables = [...trimmed.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]!);
    const unsupported = usedVariables.filter((name) => !allowed.has(name));
    if (unsupported.length > 0) {
      throw new BadRequestException(
        `This message does not support {{${unsupported[0]}}}. Supported variables: ${
          allowed.size > 0
            ? [...allowed].map((v) => `{{${v}}}`).join(', ')
            : '(none for this message)'
        }.`,
      );
    }
  }

  private assertValidPhone(phone: string): void {
    const trimmed = phone.trim();
    if (trimmed.length > 0 && trimmed.length < 7) {
      throw new BadRequestException('Support phone number is too short.');
    }
  }

  private assertValidEmail(email: string): void {
    const trimmed = email.trim();
    if (trimmed.length > 0 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      throw new BadRequestException('Enter a valid support email address.');
    }
  }

  // -----------------------------------------------------------------------
  // Access control — brief §Phase 24, reuses the EXISTING configurable
  // permission architecture only, never a hard-coded role check.
  // -----------------------------------------------------------------------

  private async assertView(organisationId: string, actorUserId: string): Promise<void> {
    const access = await this.effectiveAccessResolver.resolve(organisationId, actorUserId);
    if (
      access.isOwnerBypass ||
      access.grants.has(D2C_CONVERSATION_VIEW) ||
      access.grants.has(D2C_CONVERSATION_MANAGE)
    ) {
      return;
    }
    throw new ForbiddenException('You are not authorized to view D2C conversation configuration');
  }

  private async assertManage(organisationId: string, actorUserId: string): Promise<void> {
    const access = await this.effectiveAccessResolver.resolve(organisationId, actorUserId);
    if (access.isOwnerBypass || access.grants.has(D2C_CONVERSATION_MANAGE)) {
      return;
    }
    throw new ForbiddenException('You are not authorized to edit D2C conversation configuration');
  }
}
