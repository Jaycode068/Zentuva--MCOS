import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { EMAIL_PROVIDER } from '../ports/email-provider.port';
import { LocalEmailProvider } from './local-email-provider';
import { SmtpEmailProvider } from './smtp-email-provider';

/**
 * Provides {@link EMAIL_PROVIDER} — mirrors `FileStorageModule`'s exact pattern
 * (Sprint 3.4). `EMAIL_PROVIDER_MODE` (default `local`) picks the adapter ONCE at
 * app boot; nothing downstream branches on provider mode again. `LocalEmailProvider`
 * is always constructed and exported too (as its own concrete class, not just
 * behind the token) so tests and the admin/dev tooling can inspect recorded
 * messages even when running in `smtp` mode is never actually being asserted
 * against — see notifications.md §11 "Local provider."
 */
@Module({
  imports: [ConfigModule],
  providers: [
    LocalEmailProvider,
    {
      provide: EMAIL_PROVIDER,
      useFactory: (config: ConfigService, local: LocalEmailProvider) => {
        const mode = config.get<'local' | 'smtp'>('email.providerMode') ?? 'local';
        if (mode === 'smtp') {
          return new SmtpEmailProvider(config);
        }
        return local;
      },
      inject: [ConfigService, LocalEmailProvider],
    },
  ],
  exports: [EMAIL_PROVIDER, LocalEmailProvider],
})
export class EmailProviderModule {}
