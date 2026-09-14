import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { IdentityModule } from '../identity.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CommonAccessGuard } from './guards/common-access.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { PermissionsGuard } from './guards/permissions.guard';
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
 * `JwtAuthGuard`/`RolesGuard`/`PermissionsGuard`/`CommonAccessGuard` are exported
 * (Sprint 2.1, extended Sprint 25) so other domain modules (OrganisationModule,
 * Finance, ...) can `@UseGuards(...)` them; `TOKEN_SERVICE` is also exported for
 * `JwtAuthGuard`'s sake. A guard's own constructor dependencies (e.g.
 * `PermissionsGuard`'s `EffectiveAccessResolver`) are resolved from **this module's own
 * container** when Nest instantiates the guard — not from whichever module actually
 * uses `@UseGuards(PermissionsGuard)` — because this is the guard's home module (where
 * it's declared as a provider). Since this module already imports `IdentityModule`
 * (which exports `EffectiveAccessResolver`/`ScopeEvaluator`), that resolution just
 * works without either of them needing to be re-exported here too — attempting to
 * export a provider this module doesn't itself declare is a NestJS error ("Nest cannot
 * export a provider/module that is not part of the currently processed module"), not a
 * silent no-op, which is how this misunderstanding first got caught. A *controller*
 * that wants to inject `EffectiveAccessResolver` directly (not via a guard) still needs
 * its own module to import `IdentityModule` itself — see `HrModule`/
 * `AccessControlModule`, both of which already do.
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
    PermissionsGuard,
    CommonAccessGuard,
  ],
  // AuthService exported Sprint 3.3 so AccountModule can reuse it (change-password,
  // session listing/revocation) rather than duplicating that orchestration.
  exports: [
    AuthService,
    TOKEN_SERVICE,
    JwtAuthGuard,
    RolesGuard,
    PermissionsGuard,
    CommonAccessGuard,
  ],
})
export class AuthModule {}
