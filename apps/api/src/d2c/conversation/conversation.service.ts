import { randomUUID } from 'node:crypto';

import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConsumerConversation, Consumer, Prisma, Territory } from '@prisma/client';
import { ConversationInput, SendConversationMessageInput } from '@zentuva/validation';

import { AuditService } from '../../identity/audit/audit.service';
import { LoyaltyService } from '../../promotions/loyalty/loyalty.service';
import { TerritoryRepository } from '../../retail/territory/territory.repository';
import { ConsumerService } from '../consumer/consumer.service';
import {
  buildMainMenuMessages,
  buildWelcomeMessage,
  isCapabilityEnabled,
  renderConversationMessage,
} from '../conversation-config/d2c-conversation-config-rendering';
import { D2CConversationConfigService } from '../conversation-config/d2c-conversation-config.service';
import { EffectiveConversationConfig } from '../conversation-config/d2c-conversation-config.types';
import { CartItemUnavailableError, D2COrderingService } from '../ordering/d2c-ordering.service';
import { CartLine } from '../ordering/d2c-ordering.types';
import { D2CPaymentService } from '../payment/d2c-payment.service';
import { PaymentProviderError } from '../payment/d2c-payment.types';
import { CONVERSATION_AUDIT_ACTIONS } from './conversation-audit-actions';
import { ConversationMessageRepository } from './conversation-message.repository';
import { ConversationRepository } from './conversation.repository';
import { ConversationOutboundMessage, ConversationOutboundResponse } from './conversation.types';

/** Sprint 43.5 — D2C Two-Way Conversation Reliability (brief §Phase 9 "Back / Cancel /
 *  Menu Commands"). Checked FIRST in `dispatch()`, from ANY state — deliberately reuses
 *  the EXISTING "wipe context, return to MAIN_MENU (or NEW)" behaviour `MENU` already
 *  had, rather than inventing a step-back navigation stack (brief: "do not introduce a
 *  complex navigation framework; use the existing conversation state architecture").
 *  `BACK`/`CANCEL`/`HOME` are intentionally synonyms for the SAME reset, not a
 *  finer-grained "undo one step" — this ONLY ever resets conversation state, never an
 *  actual business transaction (a confirmed `SalesOrder` is never touched here; see
 *  `handleAwaitingConfirm`'s own `CANCEL_ORDER` button for the one place a STILL-DRAFT
 *  order's context is explicitly discarded before it's ever created). This never
 *  shadows a state's own option with the literal label "Cancel" (e.g.
 *  `AWAITING_CONFIRM`'s `CANCEL_ORDER` button) — the channel adapter already resolves
 *  an exact label/numbered match against the currently-presented options BEFORE this
 *  class ever sees the input, so a real "Cancel" button click always arrives here as
 *  `{type:'BUTTON', value:'CANCEL_ORDER'}`, never as the literal text this set matches
 *  against. */
const RESET_COMMANDS = new Set(['MENU', 'START_OVER', 'RESTART', 'HOME', 'BACK', 'CANCEL']);

/** Sprint 43.5 — brief §Phase 5 "Input Normalization." A small, explicit, deterministic
 *  alias table — NOT a natural-language intent engine (brief §Phase 22 forbids one).
 *  Only consulted at `MAIN_MENU`, and only once the exact numeric/button/label match the
 *  channel adapter already attempts has failed — lets a real human type a natural
 *  synonym ("orders", "my rewards", "update location") instead of memorizing the exact
 *  internal command string, without guessing at anything genuinely ambiguous.
 *
 *  Sprint 44 — the alias TARGET values are the same stable internal capability
 *  identifiers `D2CConversationCapability` uses (`conversation-config` module); a
 *  tenant renaming a capability's DISPLAY LABEL never changes this table, since aliases
 *  map text to the internal id, never to a tenant's own customized label. */
const MAIN_MENU_TEXT_ALIASES: Record<string, string> = {
  ORDER: 'ORDER_SNACKS',
  SNACKS: 'ORDER_SNACKS',
  BUY: 'ORDER_SNACKS',
  'ORDER SNACKS': 'ORDER_SNACKS',
  'BUY SNACKS': 'ORDER_SNACKS',
  ORDERS: 'MY_ORDERS',
  'MY ORDERS': 'MY_ORDERS',
  'MY ORDER': 'MY_ORDERS',
  REWARDS: 'MY_REWARDS',
  'MY REWARDS': 'MY_REWARDS',
  POINTS: 'MY_REWARDS',
  ACCOUNT: 'MY_ACCOUNT',
  'MY ACCOUNT': 'MY_ACCOUNT',
  PROFILE: 'MY_ACCOUNT',
  LOCATION: 'UPDATE_LOCATION',
  'MY LOCATION': 'UPDATE_LOCATION',
  'UPDATE LOCATION': 'UPDATE_LOCATION',
  'UPDATE MY LOCATION': 'UPDATE_LOCATION',
};

interface ConversationContext {
  step?: string;
  mode?: 'REGISTRATION' | 'UPDATE';
  territoryId?: string;
  /** Sprint 34 — the Order Snacks flow's own working state, all still just JSON in the
   *  existing `context` bag (brief §17 "lightweight interaction state," never a second
   *  workflow engine). `cart`/`checkoutIdempotencyKey` are the only two fields carried
   *  across the whole `ACTIVE` state; `pendingProductId` lives only between selecting a
   *  product and supplying its quantity. */
  cart?: CartLine[];
  pendingProductId?: string;
  checkoutIdempotencyKey?: string;
  /** Sprint 35 — which order the `AWAITING_PAYMENT` step is for. */
  salesOrderId?: string;
}

/**
 * Sprint 33 — Consumer Conversation Experience Foundation
 * (docs/domains/d2c.md §"Conversation Architecture"). THE channel-neutral
 * conversation engine — this class has no knowledge of WhatsApp, HTTP, or
 * any other channel; it depends only on `ConsumerService` (Sprint 32) and
 * `TerritoryRepository` (Sprint 4.8), both entirely unchanged by this
 * sprint. A future WhatsApp adapter and the Sprint 42 simulator are both
 * expected to be thin callers of `handleInboundMessage`, never
 * reimplementations of this state machine.
 *
 * Deliberately a lightweight interaction state (brief §8) — an enum plus a
 * small JSON `context` bag walked through a handful of `if`/`switch`
 * branches — never a generic workflow engine (Zentuva already has one, see
 * `WorkflowInstance`) and never a giant state-machine framework.
 *
 * Sprint 44 — Tenant D2C Conversation Configuration (docs/domains/d2c.md "Tenant
 * Conversation Configuration"). Resolves ONE {@link EffectiveConversationConfig} per
 * inbound message (`D2CConversationConfigService.resolveEffectiveConfig`, the ONLY
 * database configuration read anywhere in this class — brief §Phase 15 "ConversationService
 * should not contain database configuration-fetching logic everywhere") and threads it
 * through every state handler in place of the plain `organisationName` string this class
 * used to pass around. The STATE MACHINE itself — which states exist, what triggers a
 * transition, which domain service handles which capability — remains entirely
 * platform-controlled code, unchanged by this sprint; only the WORDING and MENU
 * PRESENTATION a tenant sees are now configuration-driven (brief's own explicit
 * boundary, docs/domains/d2c.md "Configuration Boundary").
 */
@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);

  constructor(
    private readonly conversationRepository: ConversationRepository,
    private readonly messageRepository: ConversationMessageRepository,
    private readonly consumerService: ConsumerService,
    private readonly territoryRepository: TerritoryRepository,
    private readonly auditService: AuditService,
    private readonly d2cOrderingService: D2COrderingService,
    private readonly d2cPaymentService: D2CPaymentService,
    private readonly loyaltyService: LoyaltyService,
    private readonly configService: D2CConversationConfigService,
  ) {}

  /**
   * The single entry point a channel adapter calls. `organisationId` is
   * ALWAYS supplied by the caller (the internal controller derives it from
   * the authenticated session this sprint; a real future WhatsApp webhook
   * would resolve it from which tenant's WhatsApp Business number received
   * the message) — never trusted from the message content itself (brief
   * §21/§22).
   */
  async handleInboundMessage(
    organisationId: string,
    input: SendConversationMessageInput,
  ): Promise<ConversationOutboundResponse> {
    const channel = input.channel ?? 'WHATSAPP';
    const { conversation: created, created: isNew } =
      await this.conversationRepository.findOrCreate(
        organisationId,
        channel,
        input.externalConversationId,
      );
    const conversation = created;

    await this.messageRepository.append(
      organisationId,
      conversation.id,
      'INBOUND',
      input.input,
      input.externalMessageId,
    );

    if (isNew) {
      await this.auditService.record({
        action: CONVERSATION_AUDIT_ACTIONS.STARTED,
        entityType: 'ConsumerConversation',
        entityId: conversation.id,
        organisationId,
        metadata: { channel, externalConversationId: input.externalConversationId },
      });
    }

    let response: ConversationOutboundResponse;
    try {
      // Sprint 44 — resolved ONCE per inbound message, then threaded through every
      // state handler below; never re-resolved mid-dispatch, so a configuration change
      // saved by an admin while THIS message is being processed can never produce a
      // response that mixes old and new wording within the same turn (brief §Phase 22
      // "configuration changes affect future presentation, not an in-progress
      // response").
      const config = await this.configService.resolveEffectiveConfig(organisationId);
      response = await this.dispatch(organisationId, conversation, input.input, config);
    } catch (error) {
      // Brief §27 — never leak a Prisma/internal error to the conversation
      // itself; log it for diagnosis and respond with a safe, generic
      // conversational message instead.
      this.logger.error(
        `Conversation ${conversation.id} failed to process an inbound message`,
        error instanceof Error ? error.stack : String(error),
      );
      response = {
        conversationId: conversation.id,
        state: conversation.state,
        messages: [
          {
            type: 'TEXT',
            text: 'Sorry, something went wrong on our end. Please try again, or type MENU to start over.',
          },
        ],
      };
    }

    await this.messageRepository.append(
      organisationId,
      conversation.id,
      'OUTBOUND',
      response.messages,
    );
    return response;
  }

  // ---------------------------------------------------------------------
  // Dispatch
  // ---------------------------------------------------------------------

  private async dispatch(
    organisationId: string,
    conversation: ConsumerConversation,
    input: ConversationInput,
    config: EffectiveConversationConfig,
  ): Promise<ConversationOutboundResponse> {
    if (isResetCommand(input)) {
      return this.handleReset(organisationId, conversation, config);
    }

    // A conversation not yet linked to a Consumer always gets one more
    // chance to be recognized by phone before falling into registration —
    // covers both a brand-new conversation AND one where the underlying
    // Consumer was registered through some other means (e.g. the internal
    // admin UI) in between messages. Once `consumerId` is set (registration
    // completes mid-flow), this never re-triggers.
    if (!conversation.consumerId) {
      const found = await this.consumerService.findConsumerByPhone(
        organisationId,
        conversation.externalConversationId,
      );
      if (found) {
        const updated = await this.conversationRepository.update(organisationId, conversation.id, {
          consumerId: found.id,
          state: 'MAIN_MENU',
          context: Prisma.JsonNull,
        });
        return this.mainMenuResponse(updated!, found, 'Welcome back', config);
      }
    }

    switch (conversation.state) {
      case 'REGISTRATION':
        return this.handleRegistration(organisationId, conversation, input, config);
      case 'LOCATION_SELECTION':
        return this.handleLocationSelection(organisationId, conversation, input, config);
      case 'ACTIVE':
        return this.handleOrdering(organisationId, conversation, input, config);
      case 'MAIN_MENU':
        return this.handleMainMenu(organisationId, conversation, input, config);
      case 'NEW':
      default:
        return this.handleNew(organisationId, conversation, input, config);
    }
  }

  // ---------------------------------------------------------------------
  // NEW — welcome / "are you already registered?"
  // ---------------------------------------------------------------------

  private async handleNew(
    organisationId: string,
    conversation: ConsumerConversation,
    input: ConversationInput,
    config: EffectiveConversationConfig,
  ): Promise<ConversationOutboundResponse> {
    const context = readContext(conversation);
    const value = optionValue(input);

    // Show the welcome/"are you registered?" prompt on first contact, UNLESS
    // this very first message already IS a recognized answer (e.g. a
    // deep-link "Register" button that pre-fills the reply) — in which case
    // there is no reason to make the consumer answer a question that was
    // never actually shown to them.
    if (
      context.step !== 'AWAITING_REGISTRATION_CHOICE' &&
      value !== 'REGISTER' &&
      value !== 'YES_CONTINUE'
    ) {
      const updated = await this.conversationRepository.update(organisationId, conversation.id, {
        context: { step: 'AWAITING_REGISTRATION_CHOICE' } as Prisma.InputJsonValue,
      });
      return this.respond(updated!, [buildWelcomeMessage(config)]);
    }

    if (value === 'REGISTER') {
      const updated = await this.conversationRepository.update(organisationId, conversation.id, {
        state: 'REGISTRATION',
        context: { step: 'AWAITING_NAME' } as Prisma.InputJsonValue,
      });
      return this.respond(updated!, [{ type: 'TEXT', text: "What's your name?" }]);
    }
    if (value === 'YES_CONTINUE') {
      const found = await this.consumerService.findConsumerByPhone(
        organisationId,
        conversation.externalConversationId,
      );
      if (found) {
        const updated = await this.conversationRepository.update(organisationId, conversation.id, {
          consumerId: found.id,
          state: 'MAIN_MENU',
          context: Prisma.JsonNull,
        });
        return this.mainMenuResponse(updated!, found, 'Welcome back', config);
      }
      const updated = await this.conversationRepository.update(organisationId, conversation.id, {
        state: 'REGISTRATION',
        context: { step: 'AWAITING_NAME' } as Prisma.InputJsonValue,
      });
      return this.respond(updated!, [
        {
          type: 'TEXT',
          text: "We couldn't find an existing registration for this number. Let's get you registered.",
        },
        { type: 'TEXT', text: "What's your name?" },
      ]);
    }

    return this.respond(conversation, [
      { type: 'TEXT', text: "Sorry, I didn't understand that. Please choose an option." },
      buildWelcomeMessage(config),
    ]);
  }

  // ---------------------------------------------------------------------
  // REGISTRATION — collect name, then register (Sprint 32's own service)
  // ---------------------------------------------------------------------

  private async handleRegistration(
    organisationId: string,
    conversation: ConsumerConversation,
    input: ConversationInput,
    config: EffectiveConversationConfig,
  ): Promise<ConversationOutboundResponse> {
    if (input.type !== 'TEXT' || !input.text.trim()) {
      return this.respond(conversation, [
        { type: 'TEXT', text: 'Please tell me your name as text.' },
      ]);
    }

    const name = input.text.trim();
    let registerResult;
    try {
      registerResult = await this.consumerService.registerConsumer(organisationId, {
        fullName: name,
        phoneNumber: conversation.externalConversationId,
      });
    } catch {
      return this.respond(conversation, [
        {
          type: 'TEXT',
          text: "We couldn't complete your registration with this number. Please contact support.",
        },
      ]);
    }
    const { consumer, created } = registerResult;

    if (created) {
      await this.auditService.record({
        action: CONVERSATION_AUDIT_ACTIONS.CONSUMER_REGISTERED_VIA_CONVERSATION,
        entityType: 'Consumer',
        entityId: consumer.id,
        organisationId,
        metadata: { conversationId: conversation.id, consumerCode: consumer.consumerCode },
      });
    }

    const linked = await this.conversationRepository.update(organisationId, conversation.id, {
      consumerId: consumer.id,
    });

    return this.beginLocationSelection(organisationId, linked!, 'REGISTRATION', config);
  }

  // ---------------------------------------------------------------------
  // LOCATION_SELECTION — reuses Territory/Consumer services unchanged
  // ---------------------------------------------------------------------

  private async beginLocationSelection(
    organisationId: string,
    conversation: ConsumerConversation,
    mode: 'REGISTRATION' | 'UPDATE',
    config: EffectiveConversationConfig,
  ): Promise<ConversationOutboundResponse> {
    const { children: territoryOptions } = await this.resolveBranchPoint(organisationId, null);

    if (territoryOptions.length === 0) {
      // No territory hierarchy configured for this organisation at all —
      // never a dead end; complete without a location.
      return this.finishLocationFlow(organisationId, conversation, mode, null, config);
    }

    const updated = await this.conversationRepository.update(organisationId, conversation.id, {
      state: 'LOCATION_SELECTION',
      context: { mode, step: 'AWAITING_TERRITORY' } as Prisma.InputJsonValue,
    });
    return this.respond(updated!, [
      { type: 'LIST', text: 'Select your territory', options: toOptions(territoryOptions) },
    ]);
  }

  /**
   * Walks down from `parentId` (`null` = the organisation's own territory
   * roots) through any chain of levels that have EXACTLY ONE child,
   * stopping at the first level with zero children (a true leaf) or two-or-
   * more (a real choice) — docs/domains/d2c.md §"Territory Auto-Descent".
   *
   * Boby Bites' own seeded hierarchy is 4 levels deep (Oyo State → Ibadan →
   * {Ibadan North, Ibadan South-West} → {Bodija, Mokola, Challenge}) but
   * only the FIRST two levels are single-child chains — presenting "Oyo
   * State" (the literal root) as "select your territory" would be a
   * pointless single-button prompt. This makes NO assumption about depth
   * or names for ANY organisation's hierarchy — it simply skips any level
   * that offers no real choice, generically, for whatever shape a
   * tenant's own `Territory` tree happens to have.
   */
  private async resolveBranchPoint(
    organisationId: string,
    parentId: string | null,
  ): Promise<{ settled: Territory | null; children: Territory[] }> {
    let currentParentId = parentId;
    let settled: Territory | null = null;
    for (;;) {
      const children = await this.territoryRepository.findManyByOrganisation(organisationId, {
        status: 'ACTIVE',
        parentTerritoryId: currentParentId,
      });
      if (children.length !== 1) {
        return { settled, children };
      }
      settled = children[0]!;
      currentParentId = settled.id;
    }
  }

  private async handleLocationSelection(
    organisationId: string,
    conversation: ConsumerConversation,
    input: ConversationInput,
    config: EffectiveConversationConfig,
  ): Promise<ConversationOutboundResponse> {
    const context = readContext(conversation);
    const mode = context.mode ?? 'UPDATE';

    if (context.step === 'AWAITING_LOCATION_NOT_FOUND_TEXT') {
      if (input.type !== 'TEXT' || !input.text.trim()) {
        return this.respond(conversation, [
          { type: 'TEXT', text: 'Please describe your location as text.' },
        ]);
      }
      await this.consumerService.reportLocationNotFound(
        organisationId,
        conversation.consumerId!,
        input.text.trim(),
      );
      await this.auditService.record({
        action: CONVERSATION_AUDIT_ACTIONS.LOCATION_REQUEST_VIA_CONVERSATION,
        entityType: 'Consumer',
        entityId: conversation.consumerId!,
        organisationId,
        metadata: { conversationId: conversation.id },
      });
      return this.finishLocationFlow(
        organisationId,
        conversation,
        mode,
        { text: "Thanks. We've recorded your location request — our team will review it." },
        config,
      );
    }

    if (context.step === 'AWAITING_TERRITORY') {
      const value = optionValue(input);
      // Re-derive the CURRENT valid option set rather than trusting the
      // client's id blindly (brief §12) — the exact same branch-point
      // resolution used to present the list in the first place.
      const { children: territoryOptions } = await this.resolveBranchPoint(organisationId, null);
      const territory = value ? territoryOptions.find((t) => t.id === value) : undefined;
      if (!territory) {
        return this.respond(conversation, [
          { type: 'TEXT', text: "That's not a valid option. Please choose one from the list." },
          { type: 'LIST', text: 'Select your territory', options: toOptions(territoryOptions) },
        ]);
      }
      return this.selectTerritory(organisationId, conversation, mode, territory, config);
    }

    if (context.step === 'AWAITING_LOCATION') {
      const value = optionValue(input);
      if (value === 'LOCATION_NOT_FOUND') {
        const updated = await this.conversationRepository.update(organisationId, conversation.id, {
          context: {
            mode,
            step: 'AWAITING_LOCATION_NOT_FOUND_TEXT',
            territoryId: context.territoryId,
          } as Prisma.InputJsonValue,
        });
        return this.respond(updated!, [
          {
            type: 'TEXT',
            text: 'Please describe your location so our team can review it (e.g. the nearest landmark or area name).',
          },
        ]);
      }

      const location = value
        ? await this.territoryRepository.findById(organisationId, value)
        : null;
      if (
        !location ||
        location.parentTerritoryId !== context.territoryId ||
        location.status !== 'ACTIVE'
      ) {
        return this.respondWithLocationOptions(
          organisationId,
          conversation,
          context.territoryId!,
          "That's not a valid option. Please choose one from the list.",
        );
      }

      const updatedConsumer = await this.consumerService.updateConsumerLocation(
        organisationId,
        conversation.consumerId!,
        location.id,
      );
      await this.auditService.record({
        action: CONVERSATION_AUDIT_ACTIONS.LOCATION_UPDATED_VIA_CONVERSATION,
        entityType: 'Consumer',
        entityId: updatedConsumer.id,
        organisationId,
        metadata: { conversationId: conversation.id, territoryId: location.id },
      });
      return this.finishLocationFlow(organisationId, conversation, mode, null, config);
    }

    // Unexpected/corrupted context — fail safely back to the main menu
    // rather than getting stuck.
    return this.handleReset(organisationId, conversation, config);
  }

  private async selectTerritory(
    organisationId: string,
    conversation: ConsumerConversation,
    mode: 'REGISTRATION' | 'UPDATE',
    territory: Territory,
    config: EffectiveConversationConfig,
  ): Promise<ConversationOutboundResponse> {
    // Auto-descend past any further single-child chain below the chosen
    // territory too (e.g. a branch that narrows straight to one leaf) —
    // the same generic resolution `beginLocationSelection` uses.
    const { settled, children: locationOptions } = await this.resolveBranchPoint(
      organisationId,
      territory.id,
    );
    const effectiveTerritory = settled ?? territory;

    if (locationOptions.length === 0) {
      // The effective territory IS the leaf location — no further step.
      const updatedConsumer = await this.consumerService.updateConsumerLocation(
        organisationId,
        conversation.consumerId!,
        effectiveTerritory.id,
      );
      await this.auditService.record({
        action: CONVERSATION_AUDIT_ACTIONS.LOCATION_UPDATED_VIA_CONVERSATION,
        entityType: 'Consumer',
        entityId: updatedConsumer.id,
        organisationId,
        metadata: { conversationId: conversation.id, territoryId: effectiveTerritory.id },
      });
      return this.finishLocationFlow(organisationId, conversation, mode, null, config);
    }

    const updated = await this.conversationRepository.update(organisationId, conversation.id, {
      context: {
        mode,
        step: 'AWAITING_LOCATION',
        territoryId: effectiveTerritory.id,
      } as Prisma.InputJsonValue,
    });
    return this.respondWithLocationOptions(
      organisationId,
      updated!,
      effectiveTerritory.id,
      undefined,
      locationOptions,
    );
  }

  private async respondWithLocationOptions(
    organisationId: string,
    conversation: ConsumerConversation,
    territoryId: string,
    prefixText?: string,
    preFetchedLocations?: Territory[],
  ): Promise<ConversationOutboundResponse> {
    const locations =
      preFetchedLocations ??
      (await this.territoryRepository.findManyByOrganisation(organisationId, {
        status: 'ACTIVE',
        parentTerritoryId: territoryId,
      }));
    const options = [
      ...toOptions(locations),
      { value: 'LOCATION_NOT_FOUND', label: "❓ I can't find my location" },
    ];
    const messages: ConversationOutboundMessage[] = [];
    if (prefixText) messages.push({ type: 'TEXT', text: prefixText });
    messages.push({ type: 'LIST', text: 'Select your location', options });
    return this.respond(conversation, messages);
  }

  private async finishLocationFlow(
    organisationId: string,
    conversation: ConsumerConversation,
    mode: 'REGISTRATION' | 'UPDATE',
    extra: { text: string } | null,
    config: EffectiveConversationConfig,
  ): Promise<ConversationOutboundResponse> {
    const consumer = await this.consumerService.getById(organisationId, conversation.consumerId!);
    const updated = await this.conversationRepository.update(organisationId, conversation.id, {
      state: 'MAIN_MENU',
      context: Prisma.JsonNull,
    });
    const messages: ConversationOutboundMessage[] = [];
    if (extra) messages.push({ type: 'TEXT', text: extra.text });
    if (mode === 'REGISTRATION') {
      messages.push({
        type: 'TEXT',
        text: renderConversationMessage(
          'REGISTRATION_COMPLETE',
          config.messages.REGISTRATION_COMPLETE,
          { consumerCode: consumer!.consumerCode },
        ),
      });
    } else {
      messages.push({ type: 'TEXT', text: config.messages.LOCATION_UPDATED });
    }
    messages.push(...buildMainMenuMessages(config));
    return this.respond(updated!, messages);
  }

  // ---------------------------------------------------------------------
  // MAIN_MENU — "available now" capabilities only (brief §14)
  // ---------------------------------------------------------------------

  private async handleMainMenu(
    organisationId: string,
    conversation: ConsumerConversation,
    input: ConversationInput,
    config: EffectiveConversationConfig,
  ): Promise<ConversationOutboundResponse> {
    const consumer = await this.consumerService.getById(organisationId, conversation.consumerId!);
    const rawValue =
      optionValue(input) ?? (input.type === 'TEXT' ? input.text.trim().toUpperCase() : null);
    // Sprint 43.5 brief §Phase 5 — a real numbered/button/label match (resolved by the
    // channel adapter already) always wins unchanged; only a raw, unmatched TEXT value
    // is ever looked up in the alias table, and only exactly — no partial/fuzzy
    // matching, no guessing.
    const value = rawValue ? (MAIN_MENU_TEXT_ALIASES[rawValue] ?? rawValue) : null;

    // Sprint 44 brief §Phase 7 — "If a tenant disables a capability: direct invocation
    // must also be rejected safely." A disabled capability's own internal value is
    // treated exactly like any other unmatched input below — never routed to its
    // handler, regardless of how the value was resolved (a stale numbered reply, a
    // literal alias, or the real internal command string typed directly).
    const matchedCapability = value && isKnownCapability(value) ? value : null;
    if (matchedCapability && !isCapabilityEnabled(config, matchedCapability)) {
      return this.respond(conversation, [
        { type: 'TEXT', text: config.messages.UNKNOWN_COMMAND },
        ...buildMainMenuMessages(config),
      ]);
    }

    if (value === 'MY_ACCOUNT') {
      const territoryName = consumer!.territoryId
        ? (await this.territoryRepository.findById(organisationId, consumer!.territoryId))?.name
        : null;
      return this.respond(conversation, [
        {
          type: 'TEXT',
          text: [
            `Name: ${consumer!.fullName}`,
            `Consumer ID: ${consumer!.consumerCode}`,
            `Phone: ${consumer!.normalizedPhone}`,
            `Location: ${territoryName ?? 'Not set'}`,
            `Status: ${consumer!.status}`,
          ].join('\n'),
        },
        ...buildMainMenuMessages(config),
      ]);
    }

    if (value === 'UPDATE_LOCATION') {
      return this.beginLocationSelection(organisationId, conversation, 'UPDATE', config);
    }

    if (value === 'ORDER_SNACKS') {
      return this.beginOrdering(organisationId, conversation, config);
    }

    if (value === 'MY_ORDERS') {
      return this.showMyOrders(organisationId, conversation, config);
    }

    if (value === 'MY_REWARDS') {
      return this.showMyRewards(organisationId, conversation, config);
    }

    if (value === 'HELP') {
      return this.respond(conversation, [
        {
          type: 'TEXT',
          text: renderConversationMessage('HELP', config.messages.HELP, {
            businessName: config.businessName,
            supportPhone: config.supportPhone ?? 'not available',
            supportEmail: config.supportEmail ?? 'not available',
          }),
        },
        ...buildMainMenuMessages(config),
      ]);
    }

    return this.respond(conversation, [
      { type: 'TEXT', text: config.messages.UNKNOWN_COMMAND },
      ...buildMainMenuMessages(config),
    ]);
  }

  private mainMenuResponse(
    conversation: ConsumerConversation,
    consumer: Consumer,
    greetingPrefix: string,
    config: EffectiveConversationConfig,
  ): ConversationOutboundResponse {
    return this.respond(conversation, [
      { type: 'TEXT', text: `${greetingPrefix}, ${consumer.fullName} 👋` },
      ...buildMainMenuMessages(config),
    ]);
  }

  // ---------------------------------------------------------------------
  // MY_ORDERS / MY_REWARDS — Sprint 41. Both are pure reads over EXISTING
  // domains (D2COrderingService/LoyaltyService, Sprints 34/40) — never a new
  // order-history or rewards-calculation system of their own.
  // ---------------------------------------------------------------------

  private async showMyOrders(
    organisationId: string,
    conversation: ConsumerConversation,
    config: EffectiveConversationConfig,
  ): Promise<ConversationOutboundResponse> {
    const orders = await this.d2cOrderingService.listConsumerOrders(
      organisationId,
      conversation.consumerId!,
    );
    if (orders.length === 0) {
      return this.respond(conversation, [
        { type: 'TEXT', text: config.messages.MY_ORDERS_EMPTY },
        ...buildMainMenuMessages(config),
      ]);
    }
    // Sprint 42 brief §32/33 "Consumer Status Refresh" — `fulfilmentStatus`/
    // `collectionPointName` are read FRESH from `D2COrderingService` on every "My
    // Orders" request (never a persisted/cached WhatsApp-only status), so this always
    // reflects the real, current Collection Point state.
    const lines = orders.map((order) => {
      const parts = [
        order.orderCode,
        `${order.currency} ${order.total}`,
        describeOrderStatusForHistory(order.status),
      ];
      if (order.fulfilmentStatus) {
        parts.push(`Status: ${order.fulfilmentStatus}`);
      }
      if (order.collectionPointName) {
        parts.push(`Collection Point:\n${order.collectionPointName}`);
      }
      return parts.join('\n');
    });
    return this.respond(conversation, [
      { type: 'TEXT', text: ['📦 Your Recent Orders', '', lines.join('\n\n')].join('\n') },
      ...buildMainMenuMessages(config),
    ]);
  }

  private async showMyRewards(
    organisationId: string,
    conversation: ConsumerConversation,
    config: EffectiveConversationConfig,
  ): Promise<ConversationOutboundResponse> {
    const consumerId = conversation.consumerId!;
    const [account, ledger] = await Promise.all([
      this.loyaltyService.getAccount(organisationId, consumerId),
      this.loyaltyService.listLedger(organisationId, consumerId, { page: 1, pageSize: 5 }),
    ]);
    const balance = account?.balance ?? 0;
    const lines = ledger.items.map((entry) => {
      const sign = entry.amount > 0 ? '+' : '';
      const label = entry.type === 'EARN' ? 'Points earned' : 'Adjustment';
      return `${sign}${entry.amount} pts — ${label} (${entry.createdAt.toLocaleDateString()})`;
    });
    return this.respond(conversation, [
      {
        type: 'TEXT',
        text: [
          '⭐ My Rewards',
          '',
          `Balance: ${balance} points`,
          ...(lines.length > 0 ? ['', 'Recent activity:', ...lines] : []),
        ].join('\n'),
      },
      ...buildMainMenuMessages(config),
    ]);
  }

  // ---------------------------------------------------------------------
  // ACTIVE — Sprint 34 "Order Snacks" (brief §10 flow: Browse -> Select
  // Product -> Select Quantity -> Cart -> Review -> Confirm). Reuses
  // `D2COrderingService` for every validation/pricing/order-creation
  // decision; this class only ever moves `context.step`/`context.cart`
  // and renders the resulting response — never a second implementation of
  // Sales Order business rules (brief §9 "do not move Sales Order
  // business rules into the Conversation Layer").
  // ---------------------------------------------------------------------

  private async beginOrdering(
    organisationId: string,
    conversation: ConsumerConversation,
    config: EffectiveConversationConfig,
  ): Promise<ConversationOutboundResponse> {
    const updated = await this.conversationRepository.update(organisationId, conversation.id, {
      state: 'ACTIVE',
      context: { step: 'BROWSING', cart: [] } as Prisma.InputJsonValue,
    });
    return this.renderBrowsing(organisationId, updated!, [], config);
  }

  private async handleOrdering(
    organisationId: string,
    conversation: ConsumerConversation,
    input: ConversationInput,
    config: EffectiveConversationConfig,
  ): Promise<ConversationOutboundResponse> {
    const context = readContext(conversation);
    const cart = context.cart ?? [];

    switch (context.step) {
      case 'BROWSING':
        return this.handleBrowsing(organisationId, conversation, input, cart, config);
      case 'AWAITING_QUANTITY':
        return this.handleAwaitingQuantity(organisationId, conversation, input, cart, config);
      case 'CART_MENU':
        return this.handleCartMenu(organisationId, conversation, input, cart, config);
      case 'AWAITING_REMOVE':
        return this.handleAwaitingRemove(organisationId, conversation, input, cart, config);
      case 'AWAITING_CONFIRM':
        return this.handleAwaitingConfirm(
          organisationId,
          conversation,
          input,
          cart,
          context,
          config,
        );
      case 'AWAITING_PAYMENT':
        return this.handleAwaitingPayment(organisationId, conversation, context, config);
      default:
        // Unexpected/corrupted context — fail safely rather than getting stuck,
        // same convention as `handleLocationSelection`'s own fallback.
        return this.handleReset(organisationId, conversation, config);
    }
  }

  private async renderBrowsing(
    organisationId: string,
    conversation: ConsumerConversation,
    cart: CartLine[],
    config: EffectiveConversationConfig,
    prefix?: ConversationOutboundMessage,
  ): Promise<ConversationOutboundResponse> {
    const products = await this.d2cOrderingService.getAvailableProducts(organisationId);
    const messages: ConversationOutboundMessage[] = [];
    if (prefix) messages.push(prefix);

    if (products.length === 0) {
      // No D2C-orderable products exist for this tenant — never leave the consumer
      // stuck in BROWSING while displaying main-menu buttons (found live: clicking one
      // of those buttons was previously misrouted into `handleBrowsing` as if it were a
      // product selection, since the conversation's actual persisted state never
      // changed). Genuinely return to MAIN_MENU here.
      const updated = await this.conversationRepository.update(organisationId, conversation.id, {
        state: 'MAIN_MENU',
        context: Prisma.JsonNull,
      });
      messages.push({
        type: 'TEXT',
        text: 'Sorry, there are no products available to order right now.',
      });
      messages.push(...buildMainMenuMessages(config));
      return this.respond(updated!, messages);
    }

    messages.push({
      type: 'LIST',
      text: 'Select a product',
      options: products.map((product) => ({
        value: product.skuId,
        label: `${product.displayName ?? product.productName}${
          product.variantName ? ` - ${product.variantName}` : ''
        } - ${product.currency} ${product.sellingPrice}`,
      })),
    });
    if (cart.length > 0) {
      messages.push({
        type: 'BUTTONS',
        text: `You have ${cart.length} item(s) in your cart.`,
        options: [{ value: 'VIEW_CART', label: 'View Cart & Checkout' }],
      });
    }
    return this.respond(conversation, messages);
  }

  private async handleBrowsing(
    organisationId: string,
    conversation: ConsumerConversation,
    input: ConversationInput,
    cart: CartLine[],
    config: EffectiveConversationConfig,
  ): Promise<ConversationOutboundResponse> {
    const value = optionValue(input);
    if (value === 'VIEW_CART') {
      return this.showCartMenu(organisationId, conversation, cart);
    }
    if (!value) {
      return this.renderBrowsing(organisationId, conversation, cart, config, {
        type: 'TEXT',
        text: 'Please select a product from the list.',
      });
    }

    // Re-derive the product from the EXISTING catalogue read rather than trusting the
    // client's id blindly — the same defensive convention `handleLocationSelection`'s
    // own `AWAITING_TERRITORY` step already established.
    const products = await this.d2cOrderingService.getAvailableProducts(organisationId);
    const product = products.find((p) => p.skuId === value);
    if (!product) {
      return this.renderBrowsing(organisationId, conversation, cart, config, {
        type: 'TEXT',
        text: "That's not a valid option. Please choose one from the list.",
      });
    }

    const updated = await this.conversationRepository.update(organisationId, conversation.id, {
      context: {
        step: 'AWAITING_QUANTITY',
        cart,
        pendingProductId: value,
      } as unknown as Prisma.InputJsonValue,
    });
    const name = `${product.displayName ?? product.productName}${
      product.variantName ? ` - ${product.variantName}` : ''
    }`;
    // Sprint 41 brief §5/§18 — a short recap (name, price, and an optional product
    // photo) before asking for quantity; `imageUrl` is channel-neutral (see
    // `ConversationOutboundMessage`'s own doc comment) — absent gracefully falls back to
    // text-only, never blocking ordering.
    return this.respond(updated!, [
      {
        type: 'TEXT',
        text: `${name}\n${product.currency} ${product.sellingPrice}`,
        ...(product.imageUrl ? { imageUrl: product.imageUrl } : {}),
      },
      { type: 'TEXT', text: config.messages.ASK_QUANTITY },
    ]);
  }

  private async handleAwaitingQuantity(
    organisationId: string,
    conversation: ConsumerConversation,
    input: ConversationInput,
    cart: CartLine[],
    config: EffectiveConversationConfig,
  ): Promise<ConversationOutboundResponse> {
    const context = readContext(conversation);
    const productId = context.pendingProductId;
    if (!productId) {
      // Corrupted context — no product was ever pending; back to browsing.
      return this.renderBrowsing(organisationId, conversation, cart, config);
    }
    const quantity = input.type === 'TEXT' ? Number.parseInt(input.text.trim(), 10) : NaN;

    let newCart: CartLine[];
    try {
      newCart = await this.d2cOrderingService.addItemToCart(
        organisationId,
        cart,
        productId,
        quantity,
      );
    } catch (error) {
      if (error instanceof BadRequestException) {
        return this.respond(conversation, [
          { type: 'TEXT', text: this.errorMessage(error) },
          { type: 'TEXT', text: config.messages.ASK_QUANTITY },
        ]);
      }
      throw error;
    }

    const updated = await this.conversationRepository.update(organisationId, conversation.id, {
      context: { step: 'CART_MENU', cart: newCart } as unknown as Prisma.InputJsonValue,
    });
    return this.showCartMenu(organisationId, updated!, newCart, {
      type: 'TEXT',
      text: 'Added to your cart.',
    });
  }

  private async showCartMenu(
    organisationId: string,
    conversation: ConsumerConversation,
    cart: CartLine[],
    prefix?: ConversationOutboundMessage,
  ): Promise<ConversationOutboundResponse> {
    const updated = await this.conversationRepository.update(organisationId, conversation.id, {
      context: { step: 'CART_MENU', cart } as unknown as Prisma.InputJsonValue,
    });
    const { summary } = await this.d2cOrderingService.getCartSummary(organisationId, cart);
    const cartText = formatCartSummary(summary);

    const messages: ConversationOutboundMessage[] = [];
    if (prefix) messages.push(prefix);
    messages.push({ type: 'TEXT', text: cartText });
    messages.push({
      type: 'BUTTONS',
      text: 'What next?',
      options: [
        { value: 'ADD_MORE', label: 'Add Another Item' },
        { value: 'CHECKOUT', label: 'Review & Confirm' },
        { value: 'REMOVE_ITEM', label: 'Remove an Item' },
      ],
    });
    return this.respond(updated!, messages);
  }

  private async handleCartMenu(
    organisationId: string,
    conversation: ConsumerConversation,
    input: ConversationInput,
    cart: CartLine[],
    config: EffectiveConversationConfig,
  ): Promise<ConversationOutboundResponse> {
    const value = optionValue(input);

    if (value === 'ADD_MORE') {
      const updated = await this.conversationRepository.update(organisationId, conversation.id, {
        context: { step: 'BROWSING', cart } as unknown as Prisma.InputJsonValue,
      });
      return this.renderBrowsing(organisationId, updated!, cart, config);
    }

    if (value === 'REMOVE_ITEM') {
      return this.presentRemoveOptions(organisationId, conversation, cart);
    }

    if (value === 'CHECKOUT') {
      return this.beginCheckout(organisationId, conversation, cart, config);
    }

    return this.showCartMenu(organisationId, conversation, cart, {
      type: 'TEXT',
      text: "Sorry, I didn't understand that.",
    });
  }

  private async presentRemoveOptions(
    organisationId: string,
    conversation: ConsumerConversation,
    cart: CartLine[],
    prefix?: ConversationOutboundMessage,
  ): Promise<ConversationOutboundResponse> {
    const { summary } = await this.d2cOrderingService.getCartSummary(organisationId, cart);
    const updated = await this.conversationRepository.update(organisationId, conversation.id, {
      context: { step: 'AWAITING_REMOVE', cart } as unknown as Prisma.InputJsonValue,
    });
    const messages: ConversationOutboundMessage[] = [];
    if (prefix) messages.push(prefix);
    messages.push({
      type: 'LIST',
      text: 'Select an item to remove',
      options: summary.lines.map((line) => ({
        value: line.productId,
        label: `${line.productName} x ${line.quantity}`,
      })),
    });
    return this.respond(updated!, messages);
  }

  private async handleAwaitingRemove(
    organisationId: string,
    conversation: ConsumerConversation,
    input: ConversationInput,
    cart: CartLine[],
    config: EffectiveConversationConfig,
  ): Promise<ConversationOutboundResponse> {
    const value = optionValue(input);
    if (!value) {
      // Sprint 43.5 brief §Phase 8 "context-aware invalid input" — explicitly say so
      // before re-showing the list, never silently re-prompt as if nothing was sent.
      return this.presentRemoveOptions(organisationId, conversation, cart, {
        type: 'TEXT',
        text: "Sorry, I didn't understand that. Please select an item from the list.",
      });
    }
    const newCart = this.d2cOrderingService.removeCartItem(cart, value);
    if (newCart.length === 0) {
      const updated = await this.conversationRepository.update(organisationId, conversation.id, {
        context: { step: 'BROWSING', cart: newCart } as unknown as Prisma.InputJsonValue,
      });
      return this.renderBrowsing(organisationId, updated!, newCart, config, {
        type: 'TEXT',
        text: 'Your cart is now empty.',
      });
    }
    return this.showCartMenu(organisationId, conversation, newCart, {
      type: 'TEXT',
      text: 'Item removed.',
    });
  }

  private async beginCheckout(
    organisationId: string,
    conversation: ConsumerConversation,
    cart: CartLine[],
    config: EffectiveConversationConfig,
    prefix?: ConversationOutboundMessage,
  ): Promise<ConversationOutboundResponse> {
    const {
      summary,
      cart: keptCart,
      removedProductIds,
    } = await this.d2cOrderingService.getCartSummary(organisationId, cart);
    if (keptCart.length === 0) {
      const updated = await this.conversationRepository.update(organisationId, conversation.id, {
        context: { step: 'BROWSING', cart: [] } as Prisma.InputJsonValue,
      });
      return this.renderBrowsing(organisationId, updated!, [], config, {
        type: 'TEXT',
        text:
          removedProductIds.length > 0
            ? "One of the items in your order is no longer available. We've updated your order. Please review it again."
            : 'Your cart is empty.',
      });
    }

    // Mint the idempotency key exactly once, the moment the consumer reaches
    // review — every subsequent confirmation attempt (including genuinely
    // concurrent duplicates) reads this SAME persisted value rather than
    // minting a new one, closing the race (docs/domains/d2c.md
    // "Idempotency").
    const idempotencyKey = randomUUID();
    const updated = await this.conversationRepository.update(organisationId, conversation.id, {
      context: {
        step: 'AWAITING_CONFIRM',
        cart: keptCart,
        checkoutIdempotencyKey: idempotencyKey,
      } as unknown as Prisma.InputJsonValue,
    });

    const messages: ConversationOutboundMessage[] = [];
    if (prefix) messages.push(prefix);
    if (removedProductIds.length > 0) {
      messages.push({
        type: 'TEXT',
        text: "One of the items in your order is no longer available. We've updated your order. Please review it again.",
      });
    }
    messages.push({ type: 'TEXT', text: formatCartSummary(summary) });
    messages.push({
      type: 'BUTTONS',
      text: 'Confirm order?',
      options: [
        { value: 'CONFIRM_ORDER', label: 'Confirm Order' },
        { value: 'EDIT_ORDER', label: 'Edit Order' },
        { value: 'CANCEL_ORDER', label: 'Cancel' },
      ],
    });
    return this.respond(updated!, messages);
  }

  private async handleAwaitingConfirm(
    organisationId: string,
    conversation: ConsumerConversation,
    input: ConversationInput,
    cart: CartLine[],
    context: ConversationContext,
    config: EffectiveConversationConfig,
  ): Promise<ConversationOutboundResponse> {
    const value = optionValue(input);

    if (value === 'EDIT_ORDER') {
      return this.showCartMenu(organisationId, conversation, cart);
    }
    if (value === 'CANCEL_ORDER') {
      const updated = await this.conversationRepository.update(organisationId, conversation.id, {
        state: 'MAIN_MENU',
        context: Prisma.JsonNull,
      });
      return this.respond(updated!, [
        { type: 'TEXT', text: config.messages.ORDER_CANCELLED },
        ...buildMainMenuMessages(config),
      ]);
    }
    if (value !== 'CONFIRM_ORDER') {
      // Sprint 43.5 brief §Phase 8's own ORDER_CONFIRMATION example ("maybe" -> explain
      // the available options) — explicitly say so before re-showing the summary.
      return this.beginCheckout(organisationId, conversation, cart, config, {
        type: 'TEXT',
        text: "Sorry, I didn't understand that. Please choose one of the options below.",
      });
    }

    const idempotencyKey = context.checkoutIdempotencyKey;
    if (!idempotencyKey) {
      // Corrupted context — no key was ever minted; safest is to rebuild the
      // review step, which mints a fresh one.
      return this.beginCheckout(organisationId, conversation, cart, config);
    }

    try {
      const { result, wasCreated } = await this.d2cOrderingService.confirmOrder(
        organisationId,
        conversation.consumerId!,
        cart,
        idempotencyKey,
      );
      if (wasCreated) {
        await this.auditService.record({
          action: CONVERSATION_AUDIT_ACTIONS.ORDER_CREATED_VIA_CONVERSATION,
          entityType: 'SalesOrder',
          entityId: result.orderId,
          organisationId,
          metadata: { conversationId: conversation.id, orderCode: result.orderCode },
        });
      }
      // Sprint 35 — stay in the ordering flow one more step: payment is
      // required before this order is anything more than a DRAFT record
      // of demand (docs/domains/d2c.md "Conversation UX"), never jump
      // straight to MAIN_MENU as if the order were already settled.
      const updated = await this.conversationRepository.update(organisationId, conversation.id, {
        context: {
          step: 'AWAITING_PAYMENT',
          salesOrderId: result.orderId,
        } as unknown as Prisma.InputJsonValue,
      });
      return this.respond(updated!, [
        {
          type: 'TEXT',
          text: renderConversationMessage('ORDER_CREATED', config.messages.ORDER_CREATED, {
            orderCode: result.orderCode,
            currency: result.currency,
            total: result.total,
            status: formatOrderStatusForConsumer(result.status),
          }),
        },
        {
          type: 'BUTTONS',
          text: 'Ready to pay?',
          options: [{ value: 'PAY_NOW', label: 'Pay Now' }],
        },
      ]);
    } catch (error) {
      if (error instanceof CartItemUnavailableError) {
        return this.beginCheckout(organisationId, conversation, cart, config);
      }
      if (error instanceof BadRequestException) {
        return this.respond(conversation, [{ type: 'TEXT', text: this.errorMessage(error) }]);
      }
      throw error;
    }
  }

  // ---------------------------------------------------------------------
  // AWAITING_PAYMENT — Sprint 35 "Pay Now" (brief "CONVERSATION LAYER
  // INTEGRATION"). `PAY_NOW` and a later "check my payment" both resolve
  // through the SAME `D2CPaymentService.initiatePayment` call — it is
  // idempotent/reentrant by construction (docs/domains/d2c.md "Payment
  // Reference Design"), so "start paying" and "check whether I've already
  // paid" are, from this layer's perspective, the identical operation.
  // ---------------------------------------------------------------------

  private async handleAwaitingPayment(
    organisationId: string,
    conversation: ConsumerConversation,
    context: ConversationContext,
    config: EffectiveConversationConfig,
  ): Promise<ConversationOutboundResponse> {
    const salesOrderId = context.salesOrderId;
    if (!salesOrderId) {
      // Corrupted context — no order was ever pending payment; safest is
      // the main menu rather than getting stuck.
      const updated = await this.conversationRepository.update(organisationId, conversation.id, {
        state: 'MAIN_MENU',
        context: Prisma.JsonNull,
      });
      return this.respond(updated!, buildMainMenuMessages(config));
    }

    try {
      const result = await this.d2cPaymentService.initiatePayment(
        organisationId,
        conversation.consumerId!,
        salesOrderId,
      );

      if (result.status === 'SUCCESS') {
        const updated = await this.conversationRepository.update(organisationId, conversation.id, {
          state: 'MAIN_MENU',
          context: Prisma.JsonNull,
        });
        return this.respond(updated!, [
          {
            type: 'TEXT',
            text: renderConversationMessage('PAYMENT_SUCCESS', config.messages.PAYMENT_SUCCESS, {
              orderCode: result.orderReference,
            }),
          },
          ...buildMainMenuMessages(config),
        ]);
      }

      if (result.status === 'PENDING' && result.checkoutUrl) {
        return this.respond(conversation, [
          {
            type: 'PAYMENT_REQUIRED',
            text: 'Your payment page is ready.',
            orderReference: result.orderReference,
            paymentReference: result.paymentReference,
            amount: result.amount,
            currency: result.currency,
            checkoutUrl: result.checkoutUrl,
          },
          {
            type: 'BUTTONS',
            text: 'Already paid?',
            options: [{ value: 'PAY_NOW', label: "I've Paid - Check Status" }],
          },
        ]);
      }

      if (result.status === 'PENDING') {
        // Reused an in-flight attempt that has no checkoutUrl yet (a prior
        // OPay call failed/timed out and this call just retried it, or
        // OPay reported a duplicate-reference collision) — brief
        // "Payment is still being confirmed."
        return this.respond(conversation, [
          {
            type: 'TEXT',
            text: 'Your payment is still being confirmed.\n\nWe will update your order once payment is confirmed.',
          },
          {
            type: 'BUTTONS',
            text: 'Check again?',
            options: [{ value: 'PAY_NOW', label: 'Check Status' }],
          },
        ]);
      }

      // FAILED or CLOSED — a definitive, non-pending outcome. This
      // sprint's `initiatePayment` deliberately never auto-retries a
      // failed/closed attempt against the SAME reference (documented
      // limitation, docs/domains/d2c.md "Deferred Scope") — offer the main
      // menu rather than a retry button that would just return the same
      // failed state.
      const updated = await this.conversationRepository.update(organisationId, conversation.id, {
        state: 'MAIN_MENU',
        context: Prisma.JsonNull,
      });
      return this.respond(updated!, [
        {
          type: 'TEXT',
          text:
            result.status === 'FAILED'
              ? 'Your payment was not successful. Please contact support to complete this order.'
              : 'Your payment session has closed. Please contact support to complete this order.',
        },
        ...buildMainMenuMessages(config),
      ]);
    } catch (error) {
      if (error instanceof PaymentProviderError) {
        return this.respond(conversation, [
          { type: 'TEXT', text: error.message },
          {
            type: 'BUTTONS',
            text: 'Try again?',
            options: [{ value: 'PAY_NOW', label: 'Pay Now' }],
          },
        ]);
      }
      throw error;
    }
  }

  /** Extracts a `BadRequestException`'s own consumer-friendly `message` — never its
   *  stack trace or any internal detail (brief §15/§27). */
  private errorMessage(error: BadRequestException): string {
    const response = error.getResponse();
    if (typeof response === 'string') return response;
    if (typeof response === 'object' && response && 'message' in response) {
      const message = (response as { message: unknown }).message;
      if (typeof message === 'string') return message;
      if (Array.isArray(message)) return message.join(' ');
    }
    return 'That was not a valid request. Please try again.';
  }

  // ---------------------------------------------------------------------
  // Reset — brief §20, works from any state
  // ---------------------------------------------------------------------

  private async handleReset(
    organisationId: string,
    conversation: ConsumerConversation,
    config: EffectiveConversationConfig,
  ): Promise<ConversationOutboundResponse> {
    await this.auditService.record({
      action: CONVERSATION_AUDIT_ACTIONS.RESET,
      entityType: 'ConsumerConversation',
      entityId: conversation.id,
      organisationId,
    });

    if (conversation.consumerId) {
      const updated = await this.conversationRepository.reset(
        organisationId,
        conversation.id,
        'MAIN_MENU',
      );
      const consumer = await this.consumerService.getById(organisationId, conversation.consumerId);
      return this.mainMenuResponse(updated!, consumer!, 'Welcome back', config);
    }
    const updated = await this.conversationRepository.reset(organisationId, conversation.id, 'NEW');
    return this.respond(updated!, [buildWelcomeMessage(config)]);
  }

  private respond(
    conversation: ConsumerConversation,
    messages: ConversationOutboundMessage[],
  ): ConversationOutboundResponse {
    return { conversationId: conversation.id, state: conversation.state, messages };
  }
}

// -----------------------------------------------------------------------
// Small pure helpers
// -----------------------------------------------------------------------

function readContext(conversation: ConsumerConversation): ConversationContext {
  return (conversation.context as ConversationContext | null) ?? {};
}

function isResetCommand(input: ConversationInput): boolean {
  const value =
    optionValue(input) ?? (input.type === 'TEXT' ? input.text.trim().toUpperCase() : null);
  return value !== null && RESET_COMMANDS.has(value);
}

function optionValue(input: ConversationInput): string | null {
  return input.type === 'BUTTON' || input.type === 'LIST_SELECTION' ? input.value : null;
}

/** Sprint 44 — the fixed set of internal capability identifiers
 *  (`D2CConversationCapability`), duplicated here as a plain string literal check (not
 *  an import from `@prisma/client`) purely to classify an already-resolved `value`
 *  string before the disabled-capability guard in `handleMainMenu` — never used to
 *  invent a new capability or accept an arbitrary one. */
function isKnownCapability(
  value: string,
): value is
  'ORDER_SNACKS' | 'MY_ORDERS' | 'MY_REWARDS' | 'MY_ACCOUNT' | 'UPDATE_LOCATION' | 'HELP' {
  return (
    value === 'ORDER_SNACKS' ||
    value === 'MY_ORDERS' ||
    value === 'MY_REWARDS' ||
    value === 'MY_ACCOUNT' ||
    value === 'UPDATE_LOCATION' ||
    value === 'HELP'
  );
}

function toOptions(territories: Territory[]) {
  return territories.map((t) => ({ value: t.id, label: t.name }));
}

/** brief §6 — "Your Order / Plantain Chips x 2  ₦____ / ... / Total  ₦____". The
 *  currency is always the summary's own (the tenant's real `Organisation.currency`,
 *  §"Tenant-Aware Copy" applies here just as much as to the welcome message) — never a
 *  hardcoded "₦"/"NGN". */
function formatCartSummary(summary: {
  lines: { productName: string; quantity: number; lineTotal: number }[];
  subtotal: number;
  currency: string;
}): string {
  const lines = summary.lines.map(
    (line) => `${line.productName} x ${line.quantity}   ${summary.currency} ${line.lineTotal}`,
  );
  return [
    'Your Order',
    '',
    ...lines,
    '----------------------------',
    `Total   ${summary.currency} ${summary.subtotal}`,
  ].join('\n');
}

/** brief §6/§19 — the Conversation Layer's own wording for a fresh order's status, kept
 *  entirely out of `D2COrderingService`/`SalesOrderService` (which only ever know the
 *  real `DRAFT` status — see `D2COrderResult.status`'s doc comment). Sprint 35 is
 *  expected to introduce real payment states; this mapping is the one place that will
 *  need to grow, never the business logic layer. */
function formatOrderStatusForConsumer(status: string): string {
  return status === 'DRAFT' ? 'Awaiting Payment' : status;
}

/** Sprint 41 — brief §14 "My Orders." A payment-centric label for order HISTORY,
 *  distinct wording from {@link formatOrderStatusForConsumer} (shown immediately after
 *  order creation) but the SAME underlying signal: `DRAFT` means payment was never
 *  confirmed (Sprint 35's `D2CPaymentService.handleProviderCallback` only ever
 *  transitions `DRAFT` -> `CONFIRMED` on a verified payment) — never a second payment
 *  query just to render a list. */
function describeOrderStatusForHistory(status: string): string {
  if (status === 'DRAFT') return 'Payment Pending';
  if (status === 'CANCELLED') return 'Cancelled';
  return 'Paid';
}
