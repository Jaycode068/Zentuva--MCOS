import { AuditService } from '../../identity/audit/audit.service';
import { WhatsAppProvider } from '../../notifications/ports/whatsapp-provider.port';
import { ConversationMessageRepository } from '../conversation/conversation-message.repository';
import { ConversationRepository } from '../conversation/conversation.repository';
import { ConversationService } from '../conversation/conversation.service';
import { WhatsAppInboundAdapterService } from './whatsapp-inbound-adapter.service';
import { WhatsAppOrganisationResolverService } from './whatsapp-organisation-resolver.service';
import { WhatsAppWebhookEventRepository } from './whatsapp-webhook-event.repository';
import { MetaWebhookPayload } from './whatsapp.types';

describe('WhatsAppInboundAdapterService', () => {
  function makeDeps() {
    const conversationService = {
      handleInboundMessage: jest.fn(),
    } as unknown as ConversationService;
    const conversationRepository = {
      findByExternalId: jest.fn().mockResolvedValue(null),
    } as unknown as ConversationRepository;
    const messageRepository = {
      findLastOutbound: jest.fn().mockResolvedValue(null),
    } as unknown as ConversationMessageRepository;
    const organisationResolver = {
      resolveOrganisationId: jest.fn().mockResolvedValue('org-1'),
    } as unknown as WhatsAppOrganisationResolverService;
    const webhookEventRepository = {
      tryClaim: jest.fn().mockResolvedValue(true),
    } as unknown as WhatsAppWebhookEventRepository;
    const auditService = { record: jest.fn() } as unknown as AuditService;
    const provider = {
      sendText: jest
        .fn()
        .mockResolvedValue({ outcome: 'ACCEPTED', providerMessageId: 'wamid.OUT1' }),
      sendTemplate: jest.fn(),
      sendImage: jest.fn(),
      name: 'local',
    } as unknown as WhatsAppProvider;

    const adapter = new WhatsAppInboundAdapterService(
      conversationService,
      conversationRepository,
      messageRepository,
      organisationResolver,
      webhookEventRepository,
      auditService,
      provider,
    );
    return {
      adapter,
      conversationService,
      conversationRepository,
      messageRepository,
      organisationResolver,
      webhookEventRepository,
      auditService,
      provider,
    };
  }

  function textPayload(from: string, body: string, messageId = 'wamid.IN1'): MetaWebhookPayload {
    return {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba-1',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { display_phone_number: '15551234', phone_number_id: 'pn-1' },
                messages: [
                  { id: messageId, from, timestamp: '1700000000', type: 'text', text: { body } },
                ],
              },
            },
          ],
        },
      ],
    };
  }

  it('processes a brand-new text message: resolves the organisation, forwards it as TEXT input, and sends the reply back via sendText', async () => {
    const { adapter, conversationService, provider } = makeDeps();
    (conversationService.handleInboundMessage as jest.Mock).mockResolvedValue({
      conversationId: 'conv-1',
      state: 'NEW',
      messages: [
        {
          type: 'BUTTONS',
          text: 'Welcome! Are you registered?',
          options: [
            { value: 'YES_CONTINUE', label: 'Yes, continue' },
            { value: 'REGISTER', label: 'Register' },
          ],
        },
      ],
    });

    await adapter.handleWebhookPayload(textPayload('2348012345678', 'Hi'));

    expect(conversationService.handleInboundMessage).toHaveBeenCalledWith('org-1', {
      channel: 'WHATSAPP',
      externalConversationId: '+2348012345678',
      input: { type: 'TEXT', text: 'Hi' },
    });
    expect(provider.sendText).toHaveBeenCalledWith(
      expect.objectContaining({
        toPhoneNumber: '+2348012345678',
        text: expect.stringContaining('1. Yes, continue'),
      }),
    );
  });

  it('skips an already-claimed (duplicate/redelivered) message entirely', async () => {
    const { adapter, conversationService, webhookEventRepository } = makeDeps();
    (webhookEventRepository.tryClaim as jest.Mock).mockResolvedValue(false);

    await adapter.handleWebhookPayload(textPayload('2348012345678', 'Hi'));

    expect(conversationService.handleInboundMessage).not.toHaveBeenCalled();
  });

  it('no-ops (and audit-logs) when the organisation cannot be resolved, never guessing a tenant', async () => {
    const { adapter, conversationService, organisationResolver, auditService } = makeDeps();
    (organisationResolver.resolveOrganisationId as jest.Mock).mockResolvedValue(null);

    await adapter.handleWebhookPayload(textPayload('2348012345678', 'Hi'));

    expect(conversationService.handleInboundMessage).not.toHaveBeenCalled();
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'whatsapp.organisation_unresolved' }),
    );
  });

  it('maps a numeric reply back to the correct BUTTON value using the last presented options', async () => {
    const { adapter, conversationService, conversationRepository, messageRepository } = makeDeps();
    (conversationRepository.findByExternalId as jest.Mock).mockResolvedValue({ id: 'conv-1' });
    (messageRepository.findLastOutbound as jest.Mock).mockResolvedValue({
      payload: [
        {
          type: 'BUTTONS',
          text: 'Are you registered?',
          options: [
            { value: 'YES_CONTINUE', label: 'Yes, continue' },
            { value: 'REGISTER', label: 'Register' },
          ],
        },
      ],
    });
    (conversationService.handleInboundMessage as jest.Mock).mockResolvedValue({
      conversationId: 'conv-1',
      state: 'REGISTRATION',
      messages: [{ type: 'TEXT', text: "What's your name?" }],
    });

    await adapter.handleWebhookPayload(textPayload('2348012345678', '2'));

    expect(conversationService.handleInboundMessage).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ input: { type: 'BUTTON', value: 'REGISTER' } }),
    );
  });

  it('maps a label reply (case-insensitive) back to the correct BUTTON value', async () => {
    const { adapter, conversationService, conversationRepository, messageRepository } = makeDeps();
    (conversationRepository.findByExternalId as jest.Mock).mockResolvedValue({ id: 'conv-1' });
    (messageRepository.findLastOutbound as jest.Mock).mockResolvedValue({
      payload: [
        {
          type: 'BUTTONS',
          text: 'Are you registered?',
          options: [
            { value: 'YES_CONTINUE', label: 'Yes, continue' },
            { value: 'REGISTER', label: 'Register' },
          ],
        },
      ],
    });
    (conversationService.handleInboundMessage as jest.Mock).mockResolvedValue({
      conversationId: 'conv-1',
      state: 'REGISTRATION',
      messages: [{ type: 'TEXT', text: "What's your name?" }],
    });

    await adapter.handleWebhookPayload(textPayload('2348012345678', 'register'));

    expect(conversationService.handleInboundMessage).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ input: { type: 'BUTTON', value: 'REGISTER' } }),
    );
  });

  it('uses a real WhatsApp interactive button reply id directly, without consulting history', async () => {
    const { adapter, conversationService } = makeDeps();
    (conversationService.handleInboundMessage as jest.Mock).mockResolvedValue({
      conversationId: 'conv-1',
      state: 'MAIN_MENU',
      messages: [],
    });
    const payload: MetaWebhookPayload = {
      entry: [
        {
          id: 'waba-1',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { display_phone_number: '1', phone_number_id: 'pn-1' },
                messages: [
                  {
                    id: 'wamid.INT1',
                    from: '2348012345678',
                    timestamp: '1700000000',
                    type: 'interactive',
                    interactive: {
                      type: 'button_reply',
                      button_reply: { id: 'ORDER_SNACKS', title: 'Order Snacks' },
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    await adapter.handleWebhookPayload(payload);

    expect(conversationService.handleInboundMessage).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ input: { type: 'BUTTON', value: 'ORDER_SNACKS' } }),
    );
  });

  // Sprint 41 — WhatsApp D2C Ordering & Commerce Conversation.
  it('numbers options GLOBALLY across a two-message batch (LIST + BUTTONS), never restarting at 1 per message', async () => {
    const { adapter, conversationService, provider } = makeDeps();
    (conversationService.handleInboundMessage as jest.Mock).mockResolvedValue({
      conversationId: 'conv-1',
      state: 'ACTIVE',
      messages: [
        {
          type: 'LIST',
          text: 'Select a product',
          options: [
            { value: 'sku-chips', label: 'Plantain Chips - NGN 500' },
            { value: 'sku-nuts', label: 'Roasted Groundnuts - NGN 300' },
          ],
        },
        {
          type: 'BUTTONS',
          text: 'You have 1 item(s) in your cart.',
          options: [{ value: 'VIEW_CART', label: 'View Cart & Checkout' }],
        },
      ],
    });

    await adapter.handleWebhookPayload(textPayload('2348012345678', 'Hi'));

    // The LIST is rendered first (options 1-2), the BUTTONS message continues the
    // SAME global sequence at 3 — never restarting at 1.
    const calls = (provider.sendText as jest.Mock).mock.calls as Array<[{ text: string }]>;
    expect(calls[0]![0].text).toContain('1. Plantain Chips - NGN 500');
    expect(calls[0]![0].text).toContain('2. Roasted Groundnuts - NGN 300');
    expect(calls[1]![0].text).toContain('3. View Cart & Checkout');
  });

  it('maps a numeric reply to the correct option from a flattened two-message batch (the product LIST, not the single-option BUTTONS message)', async () => {
    const { adapter, conversationService, conversationRepository, messageRepository } = makeDeps();
    (conversationRepository.findByExternalId as jest.Mock).mockResolvedValue({ id: 'conv-1' });
    (messageRepository.findLastOutbound as jest.Mock).mockResolvedValue({
      payload: [
        {
          type: 'LIST',
          text: 'Select a product',
          options: [
            { value: 'sku-chips', label: 'Plantain Chips' },
            { value: 'sku-nuts', label: 'Roasted Groundnuts' },
          ],
        },
        {
          type: 'BUTTONS',
          text: 'You have 1 item(s) in your cart.',
          options: [{ value: 'VIEW_CART', label: 'View Cart & Checkout' }],
        },
      ],
    });
    (conversationService.handleInboundMessage as jest.Mock).mockResolvedValue({
      conversationId: 'conv-1',
      state: 'ACTIVE',
      messages: [{ type: 'TEXT', text: 'How many would you like?' }],
    });

    // "2" must resolve to the SECOND product in the LIST (Roasted Groundnuts), not the
    // first (and only) BUTTONS option — the exact ambiguity the global-numbering fix
    // resolves. Before the fix, `lastPresentedOptions` returned only the BUTTONS
    // message's single option, so index 2 would have been out of range entirely.
    await adapter.handleWebhookPayload(textPayload('2348012345678', '2'));

    expect(conversationService.handleInboundMessage).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ input: { type: 'BUTTON', value: 'sku-nuts' } }),
    );
  });

  it('sends a TEXT message carrying imageUrl via sendImage, using the text as caption', async () => {
    const { adapter, conversationService, provider } = makeDeps();
    (provider.sendImage as jest.Mock).mockResolvedValue({
      outcome: 'ACCEPTED',
      providerMessageId: 'wamid.IMG1',
    });
    (conversationService.handleInboundMessage as jest.Mock).mockResolvedValue({
      conversationId: 'conv-1',
      state: 'ACTIVE',
      messages: [
        { type: 'TEXT', text: 'Plantain Chips\nNGN 500', imageUrl: 'https://cdn.test/chips.png' },
        { type: 'TEXT', text: 'How many would you like?' },
      ],
    });

    await adapter.handleWebhookPayload(textPayload('2348012345678', '1'));

    expect(provider.sendImage).toHaveBeenCalledWith(
      expect.objectContaining({
        imageUrl: 'https://cdn.test/chips.png',
        caption: 'Plantain Chips\nNGN 500',
      }),
    );
    // The SECOND message has no image — sent as plain text, unaffected.
    expect(provider.sendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'How many would you like?' }),
    );
  });

  it('falls back to sendText with the same caption when the image send fails — never blocks the conversation', async () => {
    const { adapter, conversationService, provider } = makeDeps();
    (provider.sendImage as jest.Mock).mockResolvedValue({
      outcome: 'TERMINAL_FAILURE',
      errorCode: 'WHATSAPP_INVALID_RECIPIENT',
    });
    (conversationService.handleInboundMessage as jest.Mock).mockResolvedValue({
      conversationId: 'conv-1',
      state: 'ACTIVE',
      messages: [
        { type: 'TEXT', text: 'Plantain Chips\nNGN 500', imageUrl: 'https://cdn.test/broken.png' },
      ],
    });

    await adapter.handleWebhookPayload(textPayload('2348012345678', '1'));

    expect(provider.sendImage).toHaveBeenCalled();
    expect(provider.sendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Plantain Chips\nNGN 500' }),
    );
  });

  it('audit-logs a delivery status update without touching the Conversation Layer', async () => {
    const { adapter, conversationService, auditService } = makeDeps();
    const payload: MetaWebhookPayload = {
      entry: [
        {
          id: 'waba-1',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { display_phone_number: '1', phone_number_id: 'pn-1' },
                statuses: [
                  {
                    id: 'wamid.OUT1',
                    status: 'delivered',
                    timestamp: '1700000000',
                    recipient_id: '2348012345678',
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    await adapter.handleWebhookPayload(payload);

    expect(conversationService.handleInboundMessage).not.toHaveBeenCalled();
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'whatsapp.delivery_status_received' }),
    );
  });
});
