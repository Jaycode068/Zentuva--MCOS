import { Module } from '@nestjs/common';

import { AuditRepository } from './audit/audit.repository';
import { AuditService } from './audit/audit.service';
import { CryptoModule } from './crypto/crypto.module';
import { InvitationRepository } from './invitation/invitation.repository';
import { InvitationService } from './invitation/invitation.service';
import { FileStorageModule } from './organisation/infrastructure/file-storage.module';
import { OrganisationRepository } from './organisation/organisation.repository';
import { OrganisationService } from './organisation/organisation.service';
import { PasswordResetRepository } from './password-reset/password-reset.repository';
import { PasswordResetService } from './password-reset/password-reset.service';
import { RoleRepository } from './role/role.repository';
import { RoleService } from './role/role.service';
import { SessionRepository } from './session/session.repository';
import { SessionService } from './session/session.service';
import { UserRepository } from './user/user.repository';
import { UserService } from './user/user.service';

/**
 * The Identity Domain's Database & Domain Layer: repositories and services for every
 * aggregate in docs/domains/identity.md. No controllers — this module exposes no HTTP
 * surface itself (AuthModule, Sprint 1B.2, provides the HTTP surface and imports this
 * module). PrismaModule is `@Global()` (see apps/api/src/prisma/prisma.module.ts), so
 * PrismaService doesn't need to be imported here explicitly. CryptoModule is imported
 * because UserService needs `PASSWORD_HASHER` for `verifyPassword`/account creation.
 */
@Module({
  imports: [CryptoModule, FileStorageModule],
  providers: [
    OrganisationRepository,
    OrganisationService,
    UserRepository,
    UserService,
    RoleRepository,
    RoleService,
    InvitationRepository,
    InvitationService,
    SessionRepository,
    SessionService,
    AuditRepository,
    AuditService,
    PasswordResetRepository,
    PasswordResetService,
  ],
  exports: [
    OrganisationService,
    UserService,
    RoleService,
    InvitationService,
    SessionService,
    AuditService,
    PasswordResetService,
    // SessionRepository is exported (unlike the other repositories) because AuthModule's
    // DatabaseSessionStore (Sprint 1B.2) needs token-material methods (issueRefreshToken,
    // rotateRefreshToken, ...) that deliberately don't exist on SessionService — see
    // docs/sprint-1B.2-completion-report.md "Security decisions".
    SessionRepository,
  ],
})
export class IdentityModule {}
