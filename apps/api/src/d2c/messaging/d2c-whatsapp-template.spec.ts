import { ConfigService } from '@nestjs/config';

import { resolveD2CWhatsAppTemplate } from './d2c-whatsapp-template';

describe('resolveD2CWhatsAppTemplate', () => {
  function makeConfig(values: Record<string, unknown>) {
    return { get: jest.fn((key: string) => values[key]) } as unknown as ConfigService;
  }

  it('returns null for COLLECTION_READY when no template name is configured', () => {
    const config = makeConfig({});
    expect(resolveD2CWhatsAppTemplate(config, 'COLLECTION_READY')).toBeNull();
  });

  it('returns the configured name/language for COLLECTION_READY when set', () => {
    const config = makeConfig({
      'whatsapp.d2cCollectionReadyTemplateName': 'zentuva_d2c_collection_ready',
      'whatsapp.d2cCollectionReadyTemplateLanguage': 'en_US',
    });
    expect(resolveD2CWhatsAppTemplate(config, 'COLLECTION_READY')).toEqual({
      name: 'zentuva_d2c_collection_ready',
      language: 'en_US',
    });
  });

  it('defaults language to en_US when a name is configured but language is not', () => {
    const config = makeConfig({
      'whatsapp.d2cCollectionReadyTemplateName': 'zentuva_d2c_collection_ready',
    });
    expect(resolveD2CWhatsAppTemplate(config, 'COLLECTION_READY')).toEqual({
      name: 'zentuva_d2c_collection_ready',
      language: 'en_US',
    });
  });

  it('returns null for COLLECTION_CONFIRMED when no template name is configured', () => {
    const config = makeConfig({});
    expect(resolveD2CWhatsAppTemplate(config, 'COLLECTION_CONFIRMED')).toBeNull();
  });

  it('returns the configured name/language for COLLECTION_CONFIRMED when set', () => {
    const config = makeConfig({
      'whatsapp.d2cCollectionConfirmedTemplateName': 'zentuva_d2c_collection_confirmed',
      'whatsapp.d2cCollectionConfirmedTemplateLanguage': 'fr_FR',
    });
    expect(resolveD2CWhatsAppTemplate(config, 'COLLECTION_CONFIRMED')).toEqual({
      name: 'zentuva_d2c_collection_confirmed',
      language: 'fr_FR',
    });
  });

  it("COLLECTION_READY's configured template never leaks into COLLECTION_CONFIRMED's resolution", () => {
    const config = makeConfig({
      'whatsapp.d2cCollectionReadyTemplateName': 'zentuva_d2c_collection_ready',
    });
    expect(resolveD2CWhatsAppTemplate(config, 'COLLECTION_CONFIRMED')).toBeNull();
  });

  it('always returns null for CONVERSATION_REPLY, regardless of configuration', () => {
    const config = makeConfig({
      'whatsapp.d2cCollectionReadyTemplateName': 'zentuva_d2c_collection_ready',
      'whatsapp.d2cCollectionConfirmedTemplateName': 'zentuva_d2c_collection_confirmed',
    });
    expect(resolveD2CWhatsAppTemplate(config, 'CONVERSATION_REPLY')).toBeNull();
  });
});
