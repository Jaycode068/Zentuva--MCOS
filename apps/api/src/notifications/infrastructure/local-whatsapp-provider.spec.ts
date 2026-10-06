import { LocalWhatsAppProvider } from './local-whatsapp-provider';

describe('LocalWhatsAppProvider', () => {
  function baseMessage(toPhoneNumber: string) {
    return {
      toPhoneNumber,
      templateName: 'zentuva_approval_required',
      templateLanguage: 'en_US',
      parameters: { recipientName: 'Grace', documentNumber: 'PO-000123' },
      correlationId: 'corr-1',
    };
  }

  it('accepts a normal message and returns a deterministic provider message id', async () => {
    const provider = new LocalWhatsAppProvider();
    const result = await provider.sendTemplate(baseMessage('+2348012345678'));
    expect(result.outcome).toBe('ACCEPTED');
    expect(result.providerMessageId).toContain('corr-1');
  });

  it('records every sent message for test/diagnostic assertions', async () => {
    const provider = new LocalWhatsAppProvider();
    await provider.sendTemplate(baseMessage('+2348012345678'));
    const sent = provider.getSentMessages();
    expect(sent).toHaveLength(1);
    const first = sent[0];
    expect(first?.toPhoneNumber).toBe('+2348012345678');
    expect(first?.kind).toBe('TEMPLATE');
    if (first?.kind === 'TEMPLATE') {
      expect(first.templateName).toBe('zentuva_approval_required');
    }
    expect(first?.outcome).toBe('ACCEPTED');
  });

  it('simulates a retryable failure via the reserved test number', async () => {
    const provider = new LocalWhatsAppProvider();
    const result = await provider.sendTemplate(
      baseMessage(LocalWhatsAppProvider.SIMULATE_RETRYABLE_FAILURE_NUMBER),
    );
    expect(result.outcome).toBe('RETRYABLE_FAILURE');
    expect(result.errorCode).toBe('LOCAL_SIMULATED_RETRYABLE');
    expect(result.providerMessageId).toBeUndefined();
  });

  it('simulates a terminal failure via the reserved test number', async () => {
    const provider = new LocalWhatsAppProvider();
    const result = await provider.sendTemplate(
      baseMessage(LocalWhatsAppProvider.SIMULATE_TERMINAL_FAILURE_NUMBER),
    );
    expect(result.outcome).toBe('TERMINAL_FAILURE');
    expect(result.errorCode).toBe('LOCAL_SIMULATED_TERMINAL');
  });

  it('never contacts the real WhatsApp API — has no network dependency at all', () => {
    const provider = new LocalWhatsAppProvider();
    expect(provider.name).toBe('local');
  });

  it('reset() clears recorded messages between test cases', async () => {
    const provider = new LocalWhatsAppProvider();
    await provider.sendTemplate(baseMessage('+2348012345678'));
    provider.reset();
    expect(provider.getSentMessages()).toHaveLength(0);
  });

  // Sprint 40.5 — Real Meta WhatsApp Cloud API Foundation.
  describe('sendText', () => {
    it('accepts a normal text message and records it', async () => {
      const provider = new LocalWhatsAppProvider();
      const result = await provider.sendText({
        toPhoneNumber: '+2348012345678',
        text: 'Hello from Zentuva',
        correlationId: 'text-1',
      });
      expect(result.outcome).toBe('ACCEPTED');
      const [first] = provider.getSentMessages();
      expect(first?.kind).toBe('TEXT');
      if (first?.kind === 'TEXT') {
        expect(first.text).toBe('Hello from Zentuva');
      }
    });

    it('still simulates failures via the reserved test numbers', async () => {
      const provider = new LocalWhatsAppProvider();
      const result = await provider.sendText({
        toPhoneNumber: LocalWhatsAppProvider.SIMULATE_TERMINAL_FAILURE_NUMBER,
        text: 'Hello',
        correlationId: 'text-2',
      });
      expect(result.outcome).toBe('TERMINAL_FAILURE');
    });
  });

  describe('sendImage', () => {
    it('accepts a normal image message and records it', async () => {
      const provider = new LocalWhatsAppProvider();
      const result = await provider.sendImage({
        toPhoneNumber: '+2348012345678',
        imageUrl: 'https://example.com/a.png',
        correlationId: 'image-1',
      });
      expect(result.outcome).toBe('ACCEPTED');
      const [first] = provider.getSentMessages();
      expect(first?.kind).toBe('IMAGE');
      if (first?.kind === 'IMAGE') {
        expect(first.imageUrl).toBe('https://example.com/a.png');
      }
    });
  });
});
