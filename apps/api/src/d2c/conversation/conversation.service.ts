import { Injectable, Logger } from '@nestjs/common';
import { ConsumerConversation, Consumer, Prisma, Territory } from '@prisma/client';
import { ConversationInput, SendConversationMessageInput } from '@zentuva/validation';

import { AuditService } from '../../identity/audit/audit.service';
import { OrganisationService } from '../../identity/organisation/organisation.service';
import { TerritoryRepository } from '../../retail/territory/territory.repository';
import { ConsumerService } from '../consumer/consumer.service';
import { CONVERSATION_AUDIT_ACTIONS } from './conversation-audit-actions';
import { ConversationMessageRepository } from './conversation-message.repository';
import { ConversationRepository } from './conversation.repository';
import {
  ConversationOption,
  ConversationOutboundMessage,
  ConversationOutboundResponse,
} from './conversation.types';

const RESET_COMMANDS = new Set(['MENU', 'START_OVER', 'RESTART']);

interface ConversationContext {
  step?: string;
  mode?: 'REGISTRATION' | 'UPDATE';
  territoryId?: string;
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
    private readonly organisationService: OrganisationService,
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

    await this.messageRepository.append(organisationId, conversation.id, 'INBOUND', input.input);

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
      const organisation = await this.organisationService.getById(organisationId);
      const organisationName = organisation?.displayName ?? organisation?.name ?? 'us';
      response = await this.dispatch(organisationId, conversation, input.input, organisationName);
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
    organisationName: string,
  ): Promise<ConversationOutboundResponse> {
    if (isResetCommand(input)) {
      return this.handleReset(organisationId, conversation, organisationName);
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
        return this.mainMenuResponse(updated!, found, 'Welcome back');
      }
    }

    switch (conversation.state) {
      case 'REGISTRATION':
        return this.handleRegistration(organisationId, conversation, input);
      case 'LOCATION_SELECTION':
        return this.handleLocationSelection(organisationId, conversation, input, organisationName);
      case 'MAIN_MENU':
      case 'ACTIVE':
        return this.handleMainMenu(organisationId, conversation, input);
      case 'NEW':
      default:
        return this.handleNew(organisationId, conversation, input, organisationName);
    }
  }

  // ---------------------------------------------------------------------
  // NEW — welcome / "are you already registered?"
  // ---------------------------------------------------------------------

  private async handleNew(
    organisationId: string,
    conversation: ConsumerConversation,
    input: ConversationInput,
    organisationName: string,
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
      return this.respond(updated!, [welcomeMessage(organisationName)]);
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
        return this.mainMenuResponse(updated!, found, 'Welcome back');
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
      welcomeMessage(organisationName),
    ]);
  }

  // ---------------------------------------------------------------------
  // REGISTRATION — collect name, then register (Sprint 32's own service)
  // ---------------------------------------------------------------------

  private async handleRegistration(
    organisationId: string,
    conversation: ConsumerConversation,
    input: ConversationInput,
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

    return this.beginLocationSelection(organisationId, linked!, 'REGISTRATION');
  }

  // ---------------------------------------------------------------------
  // LOCATION_SELECTION — reuses Territory/Consumer services unchanged
  // ---------------------------------------------------------------------

  private async beginLocationSelection(
    organisationId: string,
    conversation: ConsumerConversation,
    mode: 'REGISTRATION' | 'UPDATE',
  ): Promise<ConversationOutboundResponse> {
    const { children: territoryOptions } = await this.resolveBranchPoint(organisationId, null);

    if (territoryOptions.length === 0) {
      // No territory hierarchy configured for this organisation at all —
      // never a dead end; complete without a location.
      return this.finishLocationFlow(organisationId, conversation, mode, null);
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
    organisationName: string,
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
      return this.finishLocationFlow(organisationId, conversation, mode, {
        text: "Thanks. We've recorded your location request — our team will review it.",
      });
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
      return this.selectTerritory(organisationId, conversation, mode, territory);
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
      return this.finishLocationFlow(organisationId, conversation, mode, null);
    }

    // Unexpected/corrupted context — fail safely back to the main menu
    // rather than getting stuck.
    return this.handleReset(organisationId, conversation, organisationName);
  }

  private async selectTerritory(
    organisationId: string,
    conversation: ConsumerConversation,
    mode: 'REGISTRATION' | 'UPDATE',
    territory: Territory,
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
      return this.finishLocationFlow(organisationId, conversation, mode, null);
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
        text: `You're registered 🎉\n\nConsumer ID: ${consumer!.consumerCode}`,
      });
    } else {
      messages.push({ type: 'TEXT', text: 'Your location has been updated.' });
    }
    messages.push(...mainMenuMessages());
    return this.respond(updated!, messages);
  }

  // ---------------------------------------------------------------------
  // MAIN_MENU — "available now" capabilities only (brief §14)
  // ---------------------------------------------------------------------

  private async handleMainMenu(
    organisationId: string,
    conversation: ConsumerConversation,
    input: ConversationInput,
  ): Promise<ConversationOutboundResponse> {
    const consumer = await this.consumerService.getById(organisationId, conversation.consumerId!);
    const value =
      optionValue(input) ?? (input.type === 'TEXT' ? input.text.trim().toUpperCase() : null);

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
        ...mainMenuMessages(),
      ]);
    }

    if (value === 'UPDATE_LOCATION') {
      return this.beginLocationSelection(organisationId, conversation, 'UPDATE');
    }

    if (value === 'HELP') {
      return this.respond(conversation, [
        {
          type: 'TEXT',
          text: 'You can view your account, update your location, or type MENU any time to return here.',
        },
        ...mainMenuMessages(),
      ]);
    }

    return this.respond(conversation, [
      { type: 'TEXT', text: "Sorry, I didn't understand that." },
      ...mainMenuMessages(),
    ]);
  }

  private mainMenuResponse(
    conversation: ConsumerConversation,
    consumer: Consumer,
    greetingPrefix: string,
  ): ConversationOutboundResponse {
    return this.respond(conversation, [
      { type: 'TEXT', text: `${greetingPrefix}, ${consumer.fullName} 👋` },
      ...mainMenuMessages(),
    ]);
  }

  // ---------------------------------------------------------------------
  // Reset — brief §20, works from any state
  // ---------------------------------------------------------------------

  private async handleReset(
    organisationId: string,
    conversation: ConsumerConversation,
    organisationName: string,
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
      return this.mainMenuResponse(updated!, consumer!, 'Welcome back');
    }
    const updated = await this.conversationRepository.reset(organisationId, conversation.id, 'NEW');
    return this.respond(updated!, [welcomeMessage(organisationName)]);
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

function toOptions(territories: Territory[]): ConversationOption[] {
  return territories.map((t) => ({ value: t.id, label: t.name }));
}

/** `organisationName` is ALWAYS the caller's real `Organisation.displayName`/
 *  `.name` — never hardcoded to any one tenant. This is the exact bug the
 *  brief's own cross-tenant live verification is designed to catch: a
 *  literal "Welcome to Boby Bites" here would leak one tenant's brand into
 *  every other organisation's conversation (found live during this
 *  sprint's own verification, fixed before completion — see
 *  docs/domains/d2c.md §"Tenant-Aware Copy"). */
function welcomeMessage(organisationName: string): ConversationOutboundMessage {
  return {
    type: 'BUTTONS',
    text: `Welcome to ${organisationName} 👋\n\nAre you already registered?`,
    options: [
      { value: 'YES_CONTINUE', label: 'Yes, continue' },
      { value: 'REGISTER', label: 'Register' },
    ],
  };
}

function mainMenuMessages(): ConversationOutboundMessage[] {
  return [
    {
      type: 'BUTTONS',
      text: 'What would you like to do?',
      options: [
        { value: 'MY_ACCOUNT', label: 'My Account' },
        { value: 'UPDATE_LOCATION', label: 'Update My Location' },
        { value: 'HELP', label: 'Help' },
      ],
    },
  ];
}
