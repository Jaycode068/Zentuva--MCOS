import { Module } from '@nestjs/common';

import { AuditRepository } from './audit/audit.repository';
import { AuditService } from './audit/audit.service';
import { InvitationRepository } from './invitation/invitation.repository';
import { InvitationService } from './invitation/invitation.service';
import { OrganisationRepository } from './organisation/organisation.repository';
import { OrganisationService } from './organisation/organisation.service';
import { RoleRepository } from './role/role.repository';
import { RoleService } from './role/role.service';
import { SessionRepository } from './session/session.repository';
import { SessionService } from './session/session.service';
import { UserRepository } from './user/user.repository';
import { UserService } from './user/user.service';

/**
 * The Identity Domain's Database & Domain Layer (Sprint 1B.1): repositories and service
 * skeletons for every aggregate in docs/domains/identity.md. No controllers — this
 * module exposes no HTTP surface yet. PrismaModule is `@Global()` (see
 * apps/api/src/prisma/prisma.module.ts), so PrismaService doesn't need to be imported
 * here explicitly.
 */
@Module({
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
  ],
  exports: [
    OrganisationService,
    UserService,
    RoleService,
    InvitationService,
    SessionService,
    AuditService,
  ],
})
export class IdentityModule {}
