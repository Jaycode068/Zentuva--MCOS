import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { WHATSAPP_PROVIDER } from '../ports/whatsapp-provider.port';
import { LocalWhatsAppProvider } from './local-whatsapp-provider';
import { MetaWhatsAppProvider } from './meta-whatsapp-provider';

/**
 * Provides {@link WHATSAPP_PROVIDER} — mirrors `EmailProviderModule` (Sprint
 * 28) and `FileStorageModule` (Sprint 3.4) exactly. `WHATSAPP_PROVIDER_MODE`
 * (default `local`) picks the adapter ONCE at app boot; nothing downstream
 * branches on provider mode again. `LocalWhatsAppProvider` is always
 * constructed and exported too (as its own concrete class, not just behind
 * the token) so tests can inspect recorded messages even when running in
 * `meta` mode is never actually being asserted against.
 */
@Module({
  imports: [ConfigModule],
  providers: [
    LocalWhatsAppProvider,
    {
      provide: WHATSAPP_PROVIDER,
      useFactory: (config: ConfigService, local: LocalWhatsAppProvider) => {
        const mode = config.get<'local' | 'meta'>('whatsapp.providerMode') ?? 'local';
        if (mode === 'meta') {
          return new MetaWhatsAppProvider(config);
        }
        return local;
      },
      inject: [ConfigService, LocalWhatsAppProvider],
    },
  ],
  exports: [WHATSAPP_PROVIDER, LocalWhatsAppProvider],
})
export class WhatsAppProviderModule {}
