import { BadRequestException } from '@nestjs/common';

import { AuditService } from '../../identity/audit/audit.service';
import { OrganisationService } from '../../identity/organisation/organisation.service';
import { WhatsAppProvider } from '../../notifications/ports/whatsapp-provider.port';
import { WhatsAppTestController } from './whatsapp-test.controller';

describe('WhatsAppTestController', () => {
  function makeController() {
    const provider = {
      sendText: jest.fn().mockResolvedValue({ outcome: 'ACCEPTED', providerMessageId: 'wamid.T1' }),
      sendTemplate: jest
        .fn()
        .mockResolvedValue({ outcome: 'ACCEPTED', providerMessageId: 'wamid.T2' }),
      sendImage: jest
        .fn()
        .mockResolvedValue({ outcome: 'ACCEPTED', providerMessageId: 'wamid.T3' }),
      name: 'meta',
    } as unknown as WhatsAppProvider;
    const organisationService = {
      getById: jest.fn().mockResolvedValue({ country: 'Nigeria' }),
    } as unknown as OrganisationService;
    const auditService = { record: jest.fn() } as unknown as AuditService;
    const controller = new WhatsAppTestController(provider, organisationService, auditService);
    const user = { sub: 'user-1', organisationId: 'org-1' } as never;
    return { controller, provider, auditService, user };
  }

  it('sendText normalizes the recipient, forwards it to the provider, and returns a safe response shape', async () => {
    const { controller, provider, user } = makeController();
    const result = await controller.sendText({ to: '08012345678', text: 'Hello' }, user);
    expect(provider.sendText).toHaveBeenCalledWith(
      expect.objectContaining({ toPhoneNumber: '+2348012345678', text: 'Hello' }),
    );
    expect(result).toEqual({ success: true, metaMessageId: 'wamid.T1', errorCode: undefined });
  });

  it('sendTemplate forwards templateName/languageCode/bodyParameters to the provider', async () => {
    const { controller, provider, user } = makeController();
    await controller.sendTemplate(
      {
        to: '+2348012345678',
        templateName: 'jaspers_market_order_confirmation_v1',
        languageCode: 'en_US',
        bodyParameters: ['John Doe', '123456', 'Oct 6, 2026'],
      },
      user,
    );
    expect(provider.sendTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        templateName: 'jaspers_market_order_confirmation_v1',
        templateLanguage: 'en_US',
        bodyParameters: ['John Doe', '123456', 'Oct 6, 2026'],
      }),
    );
  });

  it('sendImage forwards imageUrl/caption to the provider', async () => {
    const { controller, provider, user } = makeController();
    await controller.sendImage(
      { to: '+2348012345678', imageUrl: 'https://example.com/a.png', caption: 'A caption' },
      user,
    );
    expect(provider.sendImage).toHaveBeenCalledWith(
      expect.objectContaining({ imageUrl: 'https://example.com/a.png', caption: 'A caption' }),
    );
  });

  it('throws BadRequestException when the recipient cannot be normalized', async () => {
    const { controller, user } = makeController();
    await expect(
      controller.sendText({ to: 'not-a-phone-number', text: 'Hello' }, user),
    ).rejects.toThrow(BadRequestException);
  });

  it('never exposes the provider outcome/token details beyond success/metaMessageId/errorCode', async () => {
    const { controller, provider, user } = makeController();
    (provider.sendText as jest.Mock).mockResolvedValue({
      outcome: 'TERMINAL_FAILURE',
      errorCode: 'WHATSAPP_AUTH',
      errorMessage: 'Bearer REDACTED_TOKEN was rejected',
    });
    const result = await controller.sendText({ to: '+2348012345678', text: 'Hi' }, user);
    expect(result).toEqual({
      success: false,
      metaMessageId: undefined,
      errorCode: 'WHATSAPP_AUTH',
    });
    expect(JSON.stringify(result)).not.toContain('REDACTED_TOKEN');
  });

  it('records an audit entry for every test send', async () => {
    const { controller, auditService, user } = makeController();
    await controller.sendText({ to: '+2348012345678', text: 'Hi' }, user);
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'whatsapp.test_message_sent', organisationId: 'org-1' }),
    );
  });
});
