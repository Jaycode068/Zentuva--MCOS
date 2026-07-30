/**
 * Identity Domain seed script.
 *
 * Seeds the "Boby Bites" pilot organisation, its three system roles (Owner,
 * Administrator, Member — identity.md §6), the full permission catalog (identity.md §6),
 * and the organisation's first (Owner) user.
 *
 * Runs as a plain Node script via ts-node (`prisma db seed`), outside the NestJS DI
 * container — the standard Prisma seeding pattern. It talks to Prisma directly rather
 * than through the Identity domain services, because most of them (OrganisationService.
 * register, ...) are still stubs — see docs/sprint-1B.1-completion-report.md.
 *
 * Password hashing uses `bcrypt` directly (not the `PasswordHasher` port from
 * apps/api/src/identity/crypto/ — this script runs outside the Nest DI container, so it
 * can't inject it), matching the Authentication Layer's chosen hasher (Sprint 1B.2) so
 * the seeded admin user can actually log in. Originally seeded with `argon2` in Sprint
 * 1B.1, before the Authentication Layer settled on bcrypt — see
 * docs/sprint-1B.2-completion-report.md "Deviations".
 *
 * No credentials are hardcoded: the admin email and password come from required
 * environment variables and the script fails loudly if they're missing.
 */
import * as bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';

const BCRYPT_SALT_ROUNDS = parseInt(process.env.BCRYPT_SALT_ROUNDS ?? '12', 10);

const prisma = new PrismaClient();

const BOBY_BITES_SLUG = 'boby-bites';
const BOBY_BITES_ORGANISATION_CODE = 'BBT-0001';

/** Permission catalog — identity.md §6 "Permission naming convention" examples. */
const IDENTITY_PERMISSIONS = [
  { key: 'identity.users.read', domain: 'identity', description: 'View users in the organisation' },
  {
    key: 'identity.users.update',
    domain: 'identity',
    description: "Edit a user's profile / suspend / reactivate",
  },
  {
    key: 'identity.invitations.create',
    domain: 'identity',
    description: 'Invite a new user',
  },
  {
    key: 'identity.invitations.revoke',
    domain: 'identity',
    description: 'Cancel a pending invitation',
  },
  {
    key: 'identity.roles.manage',
    domain: 'identity',
    description: 'Create/edit/delete non-system roles',
  },
  {
    key: 'identity.roles.assign',
    domain: 'identity',
    description: 'Assign/unassign roles on users',
  },
  {
    key: 'identity.audit-logs.read',
    domain: 'identity',
    description: "View the organisation's audit log",
  },
] as const;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. The seed script never hardcodes ` +
        'credentials — set it in apps/api/.env (see apps/api/.env.example) before running ' +
        '`pnpm db:seed`.',
    );
  }
  return value;
}

async function main(): Promise<void> {
  const adminEmail = requireEnv('SEED_ADMIN_EMAIL');
  const adminPassword = requireEnv('SEED_ADMIN_PASSWORD');
  const adminFirstName = process.env.SEED_ADMIN_FIRST_NAME ?? 'Organisation';
  const adminLastName = process.env.SEED_ADMIN_LAST_NAME ?? 'Owner';

  console.log('Seeding permission catalog...');
  const permissions = await Promise.all(
    IDENTITY_PERMISSIONS.map((permission) =>
      prisma.permission.upsert({
        where: { key: permission.key },
        update: { domain: permission.domain, description: permission.description },
        create: permission,
      }),
    ),
  );

  console.log('Seeding organisation "Boby Bites"...');
  const organisation = await prisma.organisation.upsert({
    where: { slug: BOBY_BITES_SLUG },
    update: {},
    create: {
      name: 'Boby Bites',
      slug: BOBY_BITES_SLUG,
      organisationCode: BOBY_BITES_ORGANISATION_CODE,
      businessEmail: adminEmail,
      country: 'Nigeria',
      status: 'ACTIVE',
    },
  });

  console.log('Seeding system roles (Owner, Administrator, Member)...');
  const ownerRole = await prisma.role.upsert({
    where: { organisationId_name: { organisationId: organisation.id, name: 'Owner' } },
    update: {},
    create: {
      organisationId: organisation.id,
      name: 'Owner',
      description: 'Full control. Bypasses the permission catalog entirely — identity.md §6.',
      isSystem: true,
    },
  });
  const administratorRole = await prisma.role.upsert({
    where: { organisationId_name: { organisationId: organisation.id, name: 'Administrator' } },
    update: {},
    create: {
      organisationId: organisation.id,
      name: 'Administrator',
      description: 'Day-to-day organisation management — identity.md §6.',
      isSystem: true,
    },
  });
  await prisma.role.upsert({
    where: { organisationId_name: { organisationId: organisation.id, name: 'Member' } },
    update: {},
    create: {
      organisationId: organisation.id,
      name: 'Member',
      description: 'Baseline authenticated user with no special permissions — identity.md §6.',
      isSystem: true,
    },
  });

  // Owner deliberately gets no explicit RolePermission rows — it bypasses the catalog
  // entirely at authorization-evaluation time (identity.md §6). Administrator gets every
  // seeded permission, matching its "day-to-day organisation management" scope.
  console.log('Granting the permission catalog to the Administrator role...');
  await prisma.rolePermission.createMany({
    data: permissions.map((permission) => ({
      roleId: administratorRole.id,
      permissionId: permission.id,
    })),
    skipDuplicates: true,
  });

  console.log('Seeding organisation admin user...');
  const passwordHash = await bcrypt.hash(adminPassword, BCRYPT_SALT_ROUNDS);
  const adminUser = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      organisationId: organisation.id,
      email: adminEmail,
      firstName: adminFirstName,
      lastName: adminLastName,
      passwordHash,
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });

  console.log('Assigning the Owner role to the admin user...');
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: adminUser.id, roleId: ownerRole.id } },
    update: {},
    create: {
      userId: adminUser.id,
      roleId: ownerRole.id,
      organisationId: organisation.id,
    },
  });

  console.log('Recording an audit log entry for this seed run...');
  await prisma.auditLog.create({
    data: {
      organisationId: organisation.id,
      actorUserId: adminUser.id,
      action: 'organisation.seeded',
      entityType: 'Organisation',
      entityId: organisation.id,
      metadata: { seededBy: 'prisma/seed.ts', roles: ['Owner', 'Administrator', 'Member'] },
    },
  });

  console.log('Seed complete:', {
    organisation: organisation.slug,
    organisationCode: organisation.organisationCode,
    adminEmail: adminUser.email,
    permissionsSeeded: permissions.length,
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
