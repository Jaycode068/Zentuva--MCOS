import { Inject, Injectable } from '@nestjs/common';
import { User, UserStatus } from '@prisma/client';

import { notImplemented } from '../common/not-implemented';
import { PASSWORD_HASHER, PasswordHasher } from '../crypto/password-hasher.port';
import { ListUsersParams, UserRepository } from './user.repository';

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
    @Inject(PASSWORD_HASHER) private readonly passwordHasher: PasswordHasher,
  ) {}

  getById(organisationId: string, id: string): Promise<User | null> {
    return this.userRepository.findById(organisationId, id);
  }

  getByEmail(email: string): Promise<User | null> {
    return this.userRepository.findByEmail(email);
  }

  listByOrganisation(organisationId: string, params?: ListUsersParams): Promise<User[]> {
    return this.userRepository.findManyByOrganisation(organisationId, params);
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

  /** Creates the first User of a newly-registered Organisation (identity.md §5
   *  Organisation Registration Flow). Organisation Registration itself is out of scope
   *  for Sprint 1B.2 — deferred. */
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

export interface UpdateUserProfileInput {
  firstName?: string;
  lastName?: string;
  employeeCode?: string;
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
