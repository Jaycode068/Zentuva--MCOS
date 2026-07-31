import { Injectable } from '@nestjs/common';
import { Organisation, OrganisationStatus, Prisma, User } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

/** Input for {@link OrganisationRepository.registerTenant} — Prisma column names
 *  throughout (the wire-to-domain field mapping happens in `OrganisationService`,
 *  matching the pattern established in Sprint 2.1/2.2). */
export interface RegisterTenantInput {
  name: string;
  displayName?: string;
  industry?: string;
  country: string;
  state?: string;
  city?: string;
  phone?: string;
  businessEmail: string;
  website?: string;
  slug: string;
  organisationCode: string;
  ownerFirstName: string;
  ownerLastName: string;
  ownerEmail: string;
  ownerPasswordHash: string;
}

export interface RegisterTenantResult {
  organisation: Organisation;
  owner: User;
}

const SYSTEM_ROLE_DESCRIPTIONS: Record<string, string> = {
  Owner: 'Full control. Bypasses the permission catalog entirely — identity.md §6.',
  Administrator: 'Day-to-day organisation management — identity.md §6.',
  Member: 'Baseline authenticated user with no special permissions — identity.md §6.',
};

/**
 * Thin Prisma access for the Organisation aggregate. No business logic — see
 * OrganisationService and docs/domains/identity.md §4/§9.
 */
@Injectable()
export class OrganisationRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.OrganisationCreateInput): Promise<Organisation> {
    return this.prisma.organisation.create({ data });
  }

  findById(id: string): Promise<Organisation | null> {
    return this.prisma.organisation.findUnique({ where: { id } });
  }

  findBySlug(slug: string): Promise<Organisation | null> {
    return this.prisma.organisation.findUnique({ where: { slug } });
  }

  findByOrganisationCode(organisationCode: string): Promise<Organisation | null> {
    return this.prisma.organisation.findUnique({ where: { organisationCode } });
  }

  async existsBySlug(slug: string): Promise<boolean> {
    const count = await this.prisma.organisation.count({ where: { slug } });
    return count > 0;
  }

  async existsByOrganisationCode(organisationCode: string): Promise<boolean> {
    const count = await this.prisma.organisation.count({ where: { organisationCode } });
    return count > 0;
  }

  /** Case-insensitive — added Sprint 3.2 for registration's "duplicate organisation
   *  name" check. `name` has no DB-level unique constraint (unlike `slug`/
   *  `organisationCode`), so this is the only place that guards against it. */
  async existsByName(name: string): Promise<boolean> {
    const count = await this.prisma.organisation.count({
      where: { name: { equals: name, mode: 'insensitive' } },
    });
    return count > 0;
  }

  updateProfile(id: string, data: Prisma.OrganisationUpdateInput): Promise<Organisation> {
    return this.prisma.organisation.update({ where: { id }, data });
  }

  updateStatus(id: string, status: OrganisationStatus): Promise<Organisation> {
    return this.prisma.organisation.update({ where: { id }, data: { status } });
  }

  /**
   * Self-service tenant provisioning (Sprint 3.2): creates the Organisation, its three
   * system roles, grants the (global) permission catalog to Administrator, creates the
   * Owner User, assigns the Owner role, and records an `organisation.created` audit
   * entry — all inside one `$transaction`, so a failure at any step rolls back
   * everything already written. This intentionally writes directly against the
   * transaction's Prisma client rather than delegating to `RoleRepository`/
   * `UserRepository`/`AuditRepository`: none of those methods currently accept an
   * external transaction client, and forcing that through every repository would be a
   * far larger change than this one registration flow needs — see
   * docs/sprint-3.2-completion-report.md "Deviations from Design." The write logic
   * itself mirrors `apps/api/prisma/seed.ts`'s proven role/permission-seeding pattern.
   */
  async registerTenant(input: RegisterTenantInput): Promise<RegisterTenantResult> {
    return this.prisma.$transaction(async (tx) => {
      const organisation = await tx.organisation.create({
        data: {
          name: input.name,
          displayName: input.displayName,
          industry: input.industry,
          country: input.country,
          state: input.state,
          city: input.city,
          phone: input.phone,
          businessEmail: input.businessEmail,
          website: input.website,
          slug: input.slug,
          organisationCode: input.organisationCode,
          status: 'ACTIVE',
        },
      });

      const ownerRole = await tx.role.create({
        data: {
          organisationId: organisation.id,
          name: 'Owner',
          description: SYSTEM_ROLE_DESCRIPTIONS.Owner,
          isSystem: true,
        },
      });
      const administratorRole = await tx.role.create({
        data: {
          organisationId: organisation.id,
          name: 'Administrator',
          description: SYSTEM_ROLE_DESCRIPTIONS.Administrator,
          isSystem: true,
        },
      });
      await tx.role.create({
        data: {
          organisationId: organisation.id,
          name: 'Member',
          description: SYSTEM_ROLE_DESCRIPTIONS.Member,
          isSystem: true,
        },
      });

      // Permission is the one global (non-tenant-scoped) table — identity.md §7. If
      // nothing has been seeded yet (e.g. a fresh environment where `prisma db seed`
      // was never run), this is simply a no-op rather than an error: RolesGuard checks
      // role *names*, not permission grants, so an empty catalog doesn't block anything
      // this sprint's endpoints need.
      const permissions = await tx.permission.findMany();
      if (permissions.length > 0) {
        await tx.rolePermission.createMany({
          data: permissions.map((permission) => ({
            roleId: administratorRole.id,
            permissionId: permission.id,
          })),
        });
      }

      const owner = await tx.user.create({
        data: {
          organisationId: organisation.id,
          email: input.ownerEmail,
          firstName: input.ownerFirstName,
          lastName: input.ownerLastName,
          passwordHash: input.ownerPasswordHash,
          status: 'ACTIVE',
          emailVerifiedAt: new Date(),
        },
      });

      await tx.userRole.create({
        data: { organisationId: organisation.id, userId: owner.id, roleId: ownerRole.id },
      });

      await tx.auditLog.create({
        data: {
          organisationId: organisation.id,
          actorUserId: owner.id,
          action: 'organisation.created',
          entityType: 'Organisation',
          entityId: organisation.id,
          metadata: { ownerEmail: owner.email, seededRoles: ['Owner', 'Administrator', 'Member'] },
        },
      });

      return { organisation, owner };
    });
  }
}
