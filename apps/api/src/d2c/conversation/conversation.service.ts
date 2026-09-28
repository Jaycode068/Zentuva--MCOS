import { randomUUID } from 'node:crypto';

import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConsumerConversation, Consumer, Prisma, Territory } from '@prisma/client';
import { ConversationInput, SendConversationMessageInput } from '@zentuva/validation';

import { AuditService } from '../../identity/audit/audit.service';
import { OrganisationService } from '../../identity/organisation/organisation.service';
import { TerritoryRepository } from '../../retail/territory/territory.repository';
import { ConsumerService } from '../consumer/consumer.service';
import { CartItemUnavailableError, D2COrderingService } from '../ordering/d2c-ordering.service';
import { CartLine } from '../ordering/d2c-ordering.types';
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
  /** Sprint 34 — the Order Snacks flow's own working state, all still just JSON in the
   *  existing `context` bag (brief §17 "lightweight interaction state," never a second
   *  workflow engine). `cart`/`checkoutIdempotencyKey` are the only two fields carried
   *  across the whole `ACTIVE` state; `pendingProductId` lives only between selecting a
   *  product and supplying its quantity. */
  cart?: CartLine[];
  pendingProductId?: string;
  checkoutIdempotencyKey?: string;
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
    private readonly d2cOrderingService: D2COrderingService,
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
      case 'ACTIVE':
        return this.handleOrdering(organisationId, conversation, input, organisationName);
      case 'MAIN_MENU':
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

    if (value === 'ORDER_SNACKS') {
      return this.beginOrdering(organisationId, conversation);
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
  ): Promise<ConversationOutboundResponse> {
    const updated = await this.conversationRepository.update(organisationId, conversation.id, {
      state: 'ACTIVE',
      context: { step: 'BROWSING', cart: [] } as Prisma.InputJsonValue,
    });
    return this.renderBrowsing(organisationId, updated!, []);
  }

  private async handleOrdering(
    organisationId: string,
    conversation: ConsumerConversation,
    input: ConversationInput,
    organisationName: string,
  ): Promise<ConversationOutboundResponse> {
    const context = readContext(conversation);
    const cart = context.cart ?? [];

    switch (context.step) {
      case 'BROWSING':
        return this.handleBrowsing(organisationId, conversation, input, cart);
      case 'AWAITING_QUANTITY':
        return this.handleAwaitingQuantity(organisationId, conversation, input, cart);
      case 'CART_MENU':
        return this.handleCartMenu(organisationId, conversation, input, cart);
      case 'AWAITING_REMOVE':
        return this.handleAwaitingRemove(organisationId, conversation, input, cart);
      case 'AWAITING_CONFIRM':
        return this.handleAwaitingConfirm(organisationId, conversation, input, cart, context);
      default:
        // Unexpected/corrupted context — fail safely rather than getting stuck,
        // same convention as `handleLocationSelection`'s own fallback.
        return this.handleReset(organisationId, conversation, organisationName);
    }
  }

  private async renderBrowsing(
    organisationId: string,
    conversation: ConsumerConversation,
    cart: CartLine[],
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
      messages.push(...mainMenuMessages());
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
  ): Promise<ConversationOutboundResponse> {
    const value = optionValue(input);
    if (value === 'VIEW_CART') {
      return this.showCartMenu(organisationId, conversation, cart);
    }
    if (!value) {
      return this.renderBrowsing(organisationId, conversation, cart, {
        type: 'TEXT',
        text: 'Please select a product from the list.',
      });
    }

    const updated = await this.conversationRepository.update(organisationId, conversation.id, {
      context: {
        step: 'AWAITING_QUANTITY',
        cart,
        pendingProductId: value,
      } as unknown as Prisma.InputJsonValue,
    });
    return this.respond(updated!, [{ type: 'TEXT', text: 'How many would you like?' }]);
  }

  private async handleAwaitingQuantity(
    organisationId: string,
    conversation: ConsumerConversation,
    input: ConversationInput,
    cart: CartLine[],
  ): Promise<ConversationOutboundResponse> {
    const context = readContext(conversation);
    const productId = context.pendingProductId;
    if (!productId) {
      // Corrupted context — no product was ever pending; back to browsing.
      return this.renderBrowsing(organisationId, conversation, cart);
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
          { type: 'TEXT', text: 'How many would you like?' },
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
  ): Promise<ConversationOutboundResponse> {
    const value = optionValue(input);

    if (value === 'ADD_MORE') {
      const updated = await this.conversationRepository.update(organisationId, conversation.id, {
        context: { step: 'BROWSING', cart } as unknown as Prisma.InputJsonValue,
      });
      return this.renderBrowsing(organisationId, updated!, cart);
    }

    if (value === 'REMOVE_ITEM') {
      return this.presentRemoveOptions(organisationId, conversation, cart);
    }

    if (value === 'CHECKOUT') {
      return this.beginCheckout(organisationId, conversation, cart);
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
  ): Promise<ConversationOutboundResponse> {
    const { summary } = await this.d2cOrderingService.getCartSummary(organisationId, cart);
    const updated = await this.conversationRepository.update(organisationId, conversation.id, {
      context: { step: 'AWAITING_REMOVE', cart } as unknown as Prisma.InputJsonValue,
    });
    return this.respond(updated!, [
      {
        type: 'LIST',
        text: 'Select an item to remove',
        options: summary.lines.map((line) => ({
          value: line.productId,
          label: `${line.productName} x ${line.quantity}`,
        })),
      },
    ]);
  }

  private async handleAwaitingRemove(
    organisationId: string,
    conversation: ConsumerConversation,
    input: ConversationInput,
    cart: CartLine[],
  ): Promise<ConversationOutboundResponse> {
    const value = optionValue(input);
    if (!value) {
      return this.presentRemoveOptions(organisationId, conversation, cart);
    }
    const newCart = this.d2cOrderingService.removeCartItem(cart, value);
    if (newCart.length === 0) {
      const updated = await this.conversationRepository.update(organisationId, conversation.id, {
        context: { step: 'BROWSING', cart: newCart } as unknown as Prisma.InputJsonValue,
      });
      return this.renderBrowsing(organisationId, updated!, newCart, {
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
      return this.renderBrowsing(organisationId, updated!, [], {
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
        { type: 'TEXT', text: 'Order cancelled.' },
        ...mainMenuMessages(),
      ]);
    }
    if (value !== 'CONFIRM_ORDER') {
      return this.beginCheckout(organisationId, conversation, cart);
    }

    const idempotencyKey = context.checkoutIdempotencyKey;
    if (!idempotencyKey) {
      // Corrupted context — no key was ever minted; safest is to rebuild the
      // review step, which mints a fresh one.
      return this.beginCheckout(organisationId, conversation, cart);
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
      const updated = await this.conversationRepository.update(organisationId, conversation.id, {
        state: 'MAIN_MENU',
        context: Prisma.JsonNull,
      });
      return this.respond(updated!, [
        {
          type: 'TEXT',
          text: [
            'Order created successfully.',
            '',
            `Order: ${result.orderCode}`,
            `Amount: ${result.currency} ${result.total}`,
            `Status: ${formatOrderStatusForConsumer(result.status)}`,
          ].join('\n'),
        },
        ...mainMenuMessages(),
      ]);
    } catch (error) {
      if (error instanceof CartItemUnavailableError) {
        return this.beginCheckout(organisationId, conversation, cart);
      }
      if (error instanceof BadRequestException) {
        return this.respond(conversation, [{ type: 'TEXT', text: this.errorMessage(error) }]);
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
        // Sprint 34 — the one new "available now" capability (brief §11/§20: never
        // present a capability with no backing implementation, e.g. loyalty/rewards/
        // Collection/promotions, all still absent here).
        { value: 'ORDER_SNACKS', label: 'Order Snacks' },
        { value: 'MY_ACCOUNT', label: 'My Account' },
        { value: 'UPDATE_LOCATION', label: 'Update My Location' },
        { value: 'HELP', label: 'Help' },
      ],
    },
  ];
}
