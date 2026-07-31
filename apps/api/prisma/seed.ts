/**
 * Identity Domain seed script.
 *
 * Seeds the "Boby Bites" pilot organisation, its three system roles (Owner,
 * Administrator, Member — identity.md §6), the full permission catalog (identity.md §6),
 * and one development account per system role — Owner, Administrator, and Member (the
 * latter two added Sprint 2.2 for User Management testing: role-based authorisation needs
 * a real Administrator and a real Member to test against, not just the Owner).
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
 * No credentials are hardcoded: every account's email and password come from required
 * environment variables and the script fails loudly if they're missing — see
 * apps/api/.env.example for the predictable local-development values (Sprint 2.2 brief:
 * "documented development passwords").
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

/** Seeds one development account (email/password from required env vars) and assigns it
 *  the given role. Added Sprint 2.2 to seed Administrator and Member accounts alongside
 *  the existing Owner, using the same "no hardcoded credentials" pattern. */
async function seedUser(params: {
  organisationId: string;
  roleId: string;
  emailEnvVar: string;
  passwordEnvVar: string;
  firstNameEnvVar: string;
  lastNameEnvVar: string;
  defaultFirstName: string;
  defaultLastName: string;
}) {
  const email = requireEnv(params.emailEnvVar);
  const password = requireEnv(params.passwordEnvVar);
  const firstName = process.env[params.firstNameEnvVar] ?? params.defaultFirstName;
  const lastName = process.env[params.lastNameEnvVar] ?? params.defaultLastName;

  const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      organisationId: params.organisationId,
      email,
      firstName,
      lastName,
      passwordHash,
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: params.roleId } },
    update: {},
    create: { userId: user.id, roleId: params.roleId, organisationId: params.organisationId },
  });

  return user;
}

async function main(): Promise<void> {
  // Read early (rather than inside `seedUser`) because the organisation's `businessEmail`
  // needs it before any user is created.
  const adminEmail = requireEnv('SEED_ADMIN_EMAIL');

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
  const memberRole = await prisma.role.upsert({
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

  console.log('Seeding development accounts (Owner, Administrator, Member)...');
  const ownerUser = await seedUser({
    organisationId: organisation.id,
    roleId: ownerRole.id,
    emailEnvVar: 'SEED_ADMIN_EMAIL',
    passwordEnvVar: 'SEED_ADMIN_PASSWORD',
    firstNameEnvVar: 'SEED_ADMIN_FIRST_NAME',
    lastNameEnvVar: 'SEED_ADMIN_LAST_NAME',
    defaultFirstName: 'Organisation',
    defaultLastName: 'Owner',
  });
  const administratorUser = await seedUser({
    organisationId: organisation.id,
    roleId: administratorRole.id,
    emailEnvVar: 'SEED_ADMINISTRATOR_EMAIL',
    passwordEnvVar: 'SEED_ADMINISTRATOR_PASSWORD',
    firstNameEnvVar: 'SEED_ADMINISTRATOR_FIRST_NAME',
    lastNameEnvVar: 'SEED_ADMINISTRATOR_LAST_NAME',
    defaultFirstName: 'Boby',
    defaultLastName: 'Admin',
  });
  const memberUser = await seedUser({
    organisationId: organisation.id,
    roleId: memberRole.id,
    emailEnvVar: 'SEED_MEMBER_EMAIL',
    passwordEnvVar: 'SEED_MEMBER_PASSWORD',
    firstNameEnvVar: 'SEED_MEMBER_FIRST_NAME',
    lastNameEnvVar: 'SEED_MEMBER_LAST_NAME',
    defaultFirstName: 'Boby',
    defaultLastName: 'Member',
  });

  console.log('Recording an audit log entry for this seed run...');
  await prisma.auditLog.create({
    data: {
      organisationId: organisation.id,
      actorUserId: ownerUser.id,
      action: 'organisation.seeded',
      entityType: 'Organisation',
      entityId: organisation.id,
      metadata: { seededBy: 'prisma/seed.ts', roles: ['Owner', 'Administrator', 'Member'] },
    },
  });

  console.log('Seed complete:', {
    organisation: organisation.slug,
    organisationCode: organisation.organisationCode,
    ownerEmail: ownerUser.email,
    administratorEmail: administratorUser.email,
    memberEmail: memberUser.email,
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
