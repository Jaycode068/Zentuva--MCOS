import { ConfigService } from '@nestjs/config';

import {
  loadMetaWhatsAppConfig,
  MetaWhatsAppProvider,
  WhatsAppConfigurationError,
} from './meta-whatsapp-provider';

describe('MetaWhatsAppProvider', () => {
  const fetchMock = jest.fn();

  function makeConfig(overrides: Record<string, unknown> = {}) {
    const values: Record<string, unknown> = {
      'whatsapp.apiBaseUrl': 'https://graph.facebook.com/v20.0',
      'whatsapp.accessToken': 'REDACTED_TOKEN',
      'whatsapp.phoneNumberId': '1234567890',
      ...overrides,
    };
    return { get: jest.fn((key: string) => values[key]) } as unknown as ConfigService;
  }

  const baseMessage = {
    toPhoneNumber: '+2348012345678',
    templateName: 'zentuva_approval_required',
    templateLanguage: 'en_US',
    parameters: {
      recipientName: 'Grace',
      documentType: 'Purchase Order',
      documentNumber: 'PO-000123',
      approvalUrl: 'https://app.zentuva.test/settings/workflows/instances/abc',
    },
    correlationId: 'delivery-1',
  };

  beforeEach(() => {
    fetchMock.mockReset();
    (global as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
  });

  describe('loadMetaWhatsAppConfig / construction', () => {
    it('throws WhatsAppConfigurationError listing every missing field, without leaking any value', () => {
      const config = makeConfig({
        'whatsapp.accessToken': undefined,
        'whatsapp.phoneNumberId': undefined,
      });
      expect(() => loadMetaWhatsAppConfig(config)).toThrow(WhatsAppConfigurationError);
      try {
        loadMetaWhatsAppConfig(config);
      } catch (error) {
        expect((error as Error).message).toContain('WHATSAPP_ACCESS_TOKEN');
        expect((error as Error).message).toContain('WHATSAPP_PHONE_NUMBER_ID');
        expect((error as Error).message).not.toContain('REDACTED_TOKEN');
      }
    });

    it('constructs successfully when every required field is present', () => {
      expect(() => new MetaWhatsAppProvider(makeConfig())).not.toThrow();
    });
  });

  describe('sendTemplate', () => {
    it('returns ACCEPTED with the provider message id on success', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ messages: [{ id: 'wamid.ABC123' }] }),
      });
      const provider = new MetaWhatsAppProvider(makeConfig());
      const result = await provider.sendTemplate(baseMessage);
      expect(result).toEqual({ outcome: 'ACCEPTED', providerMessageId: 'wamid.ABC123' });
    });

    it('sends the phone number without a leading + and includes the correlation id header', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ messages: [{ id: 'wamid.ABC123' }] }),
      });
      const provider = new MetaWhatsAppProvider(makeConfig());
      await provider.sendTemplate(baseMessage);

      expect(fetchMock).toHaveBeenCalledWith(
        'https://graph.facebook.com/v20.0/1234567890/messages',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'X-Zentuva-Correlation-Id': 'delivery-1' }),
        }),
      );
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.to).toBe('2348012345678');
      expect(body.template.name).toBe('zentuva_approval_required');
      expect(body.template.components[0].parameters).toEqual([
        { type: 'text', text: 'Grace' },
        { type: 'text', text: 'Purchase Order' },
        { type: 'text', text: 'PO-000123' },
        { type: 'text', text: 'https://app.zentuva.test/settings/workflows/instances/abc' },
      ]);
    });

    it('never includes the access token in the request body', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ messages: [{ id: 'wamid.ABC123' }] }),
      });
      const provider = new MetaWhatsAppProvider(makeConfig());
      await provider.sendTemplate(baseMessage);
      const body = fetchMock.mock.calls[0][1].body as string;
      expect(body).not.toContain('REDACTED_TOKEN');
      const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer REDACTED_TOKEN');
    });

    it('maps a 401/invalid-token response to a TERMINAL_FAILURE with no token in the message', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: { code: 190, type: 'OAuthException' } }),
      });
      const provider = new MetaWhatsAppProvider(makeConfig());
      const result = await provider.sendTemplate(baseMessage);
      expect(result.outcome).toBe('TERMINAL_FAILURE');
      expect(result.errorCode).toBe('WHATSAPP_AUTH');
      expect(result.errorMessage).not.toContain('REDACTED_TOKEN');
    });

    it('maps an invalid-recipient error code to a TERMINAL_FAILURE', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: { code: 131026 } }),
      });
      const provider = new MetaWhatsAppProvider(makeConfig());
      const result = await provider.sendTemplate(baseMessage);
      expect(result.outcome).toBe('TERMINAL_FAILURE');
      expect(result.errorCode).toBe('WHATSAPP_INVALID_RECIPIENT');
    });

    it('maps an invalid-template error code to a TERMINAL_FAILURE', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: { code: 132000 } }),
      });
      const provider = new MetaWhatsAppProvider(makeConfig());
      const result = await provider.sendTemplate(baseMessage);
      expect(result.outcome).toBe('TERMINAL_FAILURE');
      expect(result.errorCode).toBe('WHATSAPP_INVALID_TEMPLATE');
    });

    it('maps a 429 rate-limit response to a RETRYABLE_FAILURE', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 429,
        json: () => Promise.resolve({ error: {} }),
      });
      const provider = new MetaWhatsAppProvider(makeConfig());
      const result = await provider.sendTemplate(baseMessage);
      expect(result.outcome).toBe('RETRYABLE_FAILURE');
      expect(result.errorCode).toBe('WHATSAPP_RATE_LIMITED');
    });

    it('maps a 5xx response to a RETRYABLE_FAILURE', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 503,
        json: () => Promise.resolve({ error: {} }),
      });
      const provider = new MetaWhatsAppProvider(makeConfig());
      const result = await provider.sendTemplate(baseMessage);
      expect(result.outcome).toBe('RETRYABLE_FAILURE');
      expect(result.errorCode).toBe('WHATSAPP_SERVER_ERROR');
    });

    it('defaults an unrecognized failure to RETRYABLE_FAILURE rather than giving up immediately', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 418,
        json: () => Promise.resolve({ error: {} }),
      });
      const provider = new MetaWhatsAppProvider(makeConfig());
      const result = await provider.sendTemplate(baseMessage);
      expect(result.outcome).toBe('RETRYABLE_FAILURE');
      expect(result.errorCode).toBe('WHATSAPP_UNKNOWN');
    });

    it('maps a network-level failure (fetch throws) to a RETRYABLE_FAILURE', async () => {
      fetchMock.mockRejectedValue(new Error('fetch failed'));
      const provider = new MetaWhatsAppProvider(makeConfig());
      const result = await provider.sendTemplate(baseMessage);
      expect(result.outcome).toBe('RETRYABLE_FAILURE');
      expect(result.errorCode).toBe('WHATSAPP_NETWORK');
    });

    it('never returns providerMessageId on a failure', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: { code: 190 } }),
      });
      const provider = new MetaWhatsAppProvider(makeConfig());
      const result = await provider.sendTemplate(baseMessage);
      expect(result.providerMessageId).toBeUndefined();
    });
  });
});
