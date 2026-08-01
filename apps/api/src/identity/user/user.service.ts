import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { User, UserStatus } from '@prisma/client';
import { CreateUserInput, UpdateUserInput, UserManagementStatusInput } from '@zentuva/validation';

import { notImplemented } from '../common/not-implemented';
import { PASSWORD_HASHER, PasswordHasher } from '../crypto/password-hasher.port';
import { RoleService } from '../role/role.service';
import { ListUsersParams, UserRepository, UserWithRoles } from './user.repository';

/**
 * Domain service for the User aggregate.
 *
 * Sprint 1B.1 implemented the pure reads/data-mutations. Sprint 1B.2 (Authentication
 * Layer) fills in `verifyPassword` and `createFromInvitationAcceptance`, since it's this
 * sprint's job to have a real {@link PasswordHasher} to use. `createFromRegistration`
 * stays a stub — Organisation Registration itself is not in this sprint's scope (see
 * docs/sprint-1B.2-completion-report.md).
 */
@Injectable()
export class UserService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly roleService: RoleService,
    @Inject(PASSWORD_HASHER) private readonly passwordHasher: PasswordHasher,
  ) {}

  getById(organisationId: string, id: string): Promise<User | null> {
    return this.userRepository.findById(organisationId, id);
  }

  getByEmail(email: string): Promise<User | null> {
    return this.userRepository.findByEmail(email);
  }

  /** Added Sprint 3.2 — `OrganisationService.register` needs a duplicate-email check
   *  before provisioning a new tenant, and `email` is globally unique (identity.md §2). */
  existsByEmail(email: string): Promise<boolean> {
    return this.userRepository.existsByEmail(email);
  }

  listByOrganisation(organisationId: string, params?: ListUsersParams): Promise<User[]> {
    return this.userRepository.findManyByOrganisation(organisationId, params);
  }

  /** Sprint 2.2 (User Management): list/detail views need each user's role, so these
   *  variants include it (via a single query — see `UserRepository`) rather than making
   *  the caller resolve it per-user. */
  listWithRoles(organisationId: string): Promise<UserWithRoles[]> {
    return this.userRepository.findManyWithRolesByOrganisation(organisationId);
  }

  getByIdWithRoles(organisationId: string, id: string): Promise<UserWithRoles | null> {
    return this.userRepository.findByIdWithRoles(organisationId, id);
  }

  /**
   * Direct user creation (Sprint 2.2 User Management brief): the creator picks a
   * temporary password and a system role — no invitation email, no self-service
   * onboarding (both explicitly deferred to Sprint 2.3). The new user is `ACTIVE`
   * immediately, since they already have a working password.
   *
   * Role resolution happens here (not the controller) because it needs `RoleService` —
   * unlike Sprint 2.1's purely-syntactic wire-to-domain field renaming, this mapping
   * requires a database lookup, so it belongs with the rest of the orchestration.
   */
  async createUser(organisationId: string, input: CreateUserInput): Promise<UserWithRoles> {
    const emailTaken = await this.userRepository.existsByEmail(input.email);
    if (emailTaken) {
      throw new ConflictException(`Email "${input.email}" is already in use`);
    }
    const role = await this.roleService.getByName(organisationId, input.role);
    if (!role) {
      throw new NotFoundException(`Role "${input.role}" does not exist in this organisation`);
    }
    const passwordHash = await this.passwordHasher.hash(input.temporaryPassword);
    return this.userRepository.createWithRole(
      {
        organisation: { connect: { id: organisationId } },
        email: input.email,
        firstName: input.firstName,
        lastName: input.lastName,
        employeeCode: input.employeeCode,
        passwordHash,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
        // Sprint 3.3: this is an admin-chosen temporary password, not one the user picked
        // themselves — force them to set their own on first login (brief §5). Self-service
        // registration and invitation acceptance leave this `false` (the schema default),
        // since the user already chose their own password in both of those flows.
        mustChangePassword: true,
      },
      organisationId,
      role.id,
    );
  }

  /** Combined profile/role/status update — one `PATCH` (Sprint 2.2 brief), not the two
   *  endpoints identity.md §10 originally sketched. Only touches the aggregates implied
   *  by whichever fields are present in `input`. */
  async updateUser(
    organisationId: string,
    id: string,
    input: UpdateUserInput,
  ): Promise<UserWithRoles> {
    // Checked up front (rather than letting UserRepository's tenant-scoped `updateMany`
    // calls fail silently) so a nonexistent id — or a cross-tenant one — reliably 404s
    // here instead of reaching a lower-level `AppError` this app has no filter for.
    const existing = await this.userRepository.findByIdWithRoles(organisationId, id);
    if (!existing) {
      throw new NotFoundException('User not found');
    }

    if (
      input.firstName !== undefined ||
      input.lastName !== undefined ||
      input.employeeCode !== undefined
    ) {
      await this.userRepository.updateProfile(organisationId, id, {
        firstName: input.firstName,
        lastName: input.lastName,
        employeeCode: input.employeeCode,
      });
    }
    if (input.status !== undefined) {
      await this.userRepository.updateStatus(organisationId, id, toDbStatus(input.status));
    }
    if (input.role !== undefined) {
      const role = await this.roleService.getByName(organisationId, input.role);
      if (!role) {
        throw new NotFoundException(`Role "${input.role}" does not exist in this organisation`);
      }
      await this.roleService.replaceUserRole(organisationId, id, role.id);
    }

    return (await this.userRepository.findByIdWithRoles(organisationId, id)) ?? existing;
  }

  updateProfile(organisationId: string, id: string, input: UpdateUserProfileInput): Promise<User> {
    return this.userRepository.updateProfile(organisationId, id, input);
  }

  updateStatus(organisationId: string, id: string, status: UserStatus): Promise<User> {
    return this.userRepository.updateStatus(organisationId, id, status);
  }

  /** Records a successful login. Pure timestamp update — no auth logic itself. */
  recordLogin(id: string): Promise<User> {
    return this.userRepository.updateLastLoginAt(id);
  }

  /** Account locking (Sprint 1B.2 brief §9): increments the failed-attempt counter and
   *  returns the updated user so the caller (AuthService) can decide whether the
   *  configured MAX_LOGIN_ATTEMPTS threshold has now been crossed. */
  recordFailedLogin(id: string): Promise<User> {
    return this.userRepository.incrementFailedLoginAttempts(id);
  }

  resetFailedLoginAttempts(id: string): Promise<User> {
    return this.userRepository.resetFailedLoginAttempts(id);
  }

  setPasswordHash(id: string, passwordHash: string): Promise<User> {
    return this.userRepository.updatePasswordHash(id, passwordHash);
  }

  async hashPassword(plaintext: string): Promise<string> {
    return this.passwordHasher.hash(plaintext);
  }

  /** Verifies a plaintext password against the stored hash (Sprint 1B.2 brief §1). */
  async verifyPassword(user: User, plaintextPassword: string): Promise<boolean> {
    return this.passwordHasher.compare(plaintextPassword, user.passwordHash);
  }

  /** Still a stub. Sprint 3.2 implemented Organisation Registration directly in
   *  `OrganisationRepository.registerTenant` instead of through this method — that flow
   *  needs one atomic transaction spanning Organisation+Role+User+UserRole+AuditLog, and
   *  no repository here currently accepts an external transaction client to participate
   *  in a cross-aggregate `$transaction`. See docs/sprint-3.2-completion-report.md
   *  "Deviations from Design." */
  createFromRegistration(_input: CreateUserFromRegistrationInput): Promise<never> {
    return notImplemented('UserService.createFromRegistration');
  }

  /** Creates a User from an accepted Invitation (identity.md §5 Invitation Flow).
   *  `firstName`/`lastName` are collected at acceptance time, not carried on the
   *  Invitation row — see docs/sprint-1B.2-completion-report.md "Deviations". */
  async createFromInvitationAcceptance(input: CreateUserFromInvitationInput): Promise<User> {
    const passwordHash = await this.passwordHasher.hash(input.password);
    return this.userRepository.create({
      organisation: { connect: { id: input.organisationId } },
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName,
      passwordHash,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
    });
  }
}

/** Wire (`UserManagementStatusInput`) -> DB (`UserStatus`) mapping — see
 *  `@zentuva/validation`'s `userManagementStatusSchema` for the reasoning. */
function toDbStatus(status: UserManagementStatusInput): UserStatus {
  switch (status) {
    case 'ACTIVE':
      return UserStatus.ACTIVE;
    case 'INACTIVE':
      return UserStatus.SUSPENDED;
    case 'LOCKED':
      return UserStatus.LOCKED;
  }
}

/** The inverse of {@link toDbStatus}, exported for `UserController`'s response mapping.
 *  `INVITED`/`DEACTIVATED` aren't reachable through this sprint's endpoints, but are
 *  mapped defensively (to `INACTIVE`) rather than left to throw, since existing rows in
 *  those statuses could still be listed. */
export function toWireStatus(status: UserStatus): UserManagementStatusInput {
  switch (status) {
    case UserStatus.ACTIVE:
      return 'ACTIVE';
    case UserStatus.LOCKED:
      return 'LOCKED';
    case UserStatus.SUSPENDED:
    case UserStatus.INVITED:
    case UserStatus.DEACTIVATED:
    default:
      return 'INACTIVE';
  }
}

export interface UpdateUserProfileInput {
  firstName?: string;
  lastName?: string;
  employeeCode?: string;
  phoneNumber?: string;
}

export interface CreateUserFromRegistrationInput {
  organisationId: string;
  email: string;
  firstName: string;
  lastName: string;
  password: string;
}

export interface CreateUserFromInvitationInput {
  organisationId: string;
  email: string;
  firstName: string;
  lastName: string;
  password: string;
}
