import { Injectable } from '@nestjs/common';
import { User, UserStatus } from '@prisma/client';

import { notImplemented } from '../common/not-implemented';
import { ListUsersParams, UserRepository } from './user.repository';

/**
 * Domain service for the User aggregate. Sprint 1B.1 scope note: see
 * OrganisationService's header comment — the same read-vs-auth-adjacent split applies
 * here. `verifyPassword` and the two creation flows require password hashing
 * (authentication logic) and are stubs.
 */
@Injectable()
export class UserService {
  constructor(private readonly userRepository: UserRepository) {}

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

  /** Records a successful login. Pure timestamp update — no auth logic itself — but only
   *  ever called by the (future) login flow, so it stays alongside the other stubs. */
  recordLogin(id: string): Promise<User> {
    return this.userRepository.updateLastLoginAt(id);
  }

  /** Creates the first User of a newly-registered Organisation (identity.md §5
   *  Organisation Registration Flow). Requires password hashing — deferred. */
  createFromRegistration(_input: CreateUserFromRegistrationInput): Promise<never> {
    return notImplemented('UserService.createFromRegistration');
  }

  /** Creates a User from an accepted Invitation (identity.md §5 Invitation Flow).
   *  Requires password hashing — deferred. */
  createFromInvitationAcceptance(_input: CreateUserFromInvitationInput): Promise<never> {
    return notImplemented('UserService.createFromInvitationAcceptance');
  }

  /** Verifies a plaintext password against the stored hash — authentication logic,
   *  explicitly out of scope this sprint. */
  verifyPassword(_userId: string, _plaintextPassword: string): Promise<never> {
    return notImplemented('UserService.verifyPassword');
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
  invitationId: string;
  password: string;
}
