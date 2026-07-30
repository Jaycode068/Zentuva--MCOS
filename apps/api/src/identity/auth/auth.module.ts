import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { IdentityModule } from '../identity.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { DatabaseSessionStore } from './infrastructure/database-session-store';
import { JwtTokenService } from './infrastructure/jwt-token.service';
import { SESSION_STORE } from './ports/session-store.port';
import { TOKEN_SERVICE } from './ports/token.port';

/**
 * The Authentication Layer (Sprint 1B.2): binds the `TokenService`/`SessionStore` ports
 * to their concrete implementations, and exposes the `/auth/*` HTTP surface. Imports
 * IdentityModule for the domain services (UserService, SessionService, ...) rather than
 * talking to Prisma directly — see docs/sprint-1B.2-completion-report.md.
 *
 * `JwtModule.register({})` needs no default secret: {@link JwtTokenService} always passes
 * an explicit `secret` per call (access vs. refresh), so there's nothing for a module-wide
 * default to do.
 */
@Module({
  imports: [IdentityModule, JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    { provide: TOKEN_SERVICE, useClass: JwtTokenService },
    { provide: SESSION_STORE, useClass: DatabaseSessionStore },
  ],
})
export class AuthModule {}
