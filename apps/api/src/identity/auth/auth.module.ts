import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { IdentityModule } from '../identity.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
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
 *
 * `JwtAuthGuard`/`RolesGuard` are exported (Sprint 2.1) so other domain modules
 * (OrganisationModule) can `@UseGuards(...)` them. `TOKEN_SERVICE` is also exported:
 * Nest resolves a `@UseGuards(SomeGuard)` class reference by instantiating it fresh within
 * the *consuming* controller's own module scope, not by reusing AuthModule's instance —
 * so that fresh instantiation needs `TOKEN_SERVICE` reachable from wherever the guard is
 * used, not just from AuthModule itself.
 */
@Module({
  imports: [IdentityModule, JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    { provide: TOKEN_SERVICE, useClass: JwtTokenService },
    { provide: SESSION_STORE, useClass: DatabaseSessionStore },
    JwtAuthGuard,
    RolesGuard,
  ],
  // AuthService exported Sprint 3.3 so AccountModule can reuse it (change-password,
  // session listing/revocation) rather than duplicating that orchestration.
  exports: [AuthService, TOKEN_SERVICE, JwtAuthGuard, RolesGuard],
})
export class AuthModule {}
