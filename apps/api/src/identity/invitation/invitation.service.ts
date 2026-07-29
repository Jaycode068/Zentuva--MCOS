import { Injectable } from '@nestjs/common';
import { Invitation, InvitationStatus } from '@prisma/client';
import { AppError } from '@zentuva/utils';

import { notImplemented } from '../common/not-implemented';
import { InvitationRepository } from './invitation.repository';

/**
 * Domain service for the Invitation aggregate.
 *
 * Sprint 1B.1 scope note: listing and revoking invitations is pure data management —
 * implemented for real. Creating an invitation (token generation + email) and accepting
 * one (token verification + password hashing + User creation) are authentication-adjacent
 * — see docs/domains/identity.md §5 Invitation Flow — and are stubs.
 */
@Injectable()
export class InvitationService {
  constructor(private readonly invitationRepository: InvitationRepository) {}

  getById(organisationId: string, id: string): Promise<Invitation | null> {
    return this.invitationRepository.findById(organisationId, id);
  }

  listByOrganisation(organisationId: string, status?: InvitationStatus): Promise<Invitation[]> {
    return this.invitationRepository.findManyByOrganisation(organisationId, status);
  }

  async revoke(organisationId: string, id: string): Promise<Invitation> {
    const existing = await this.invitationRepository.findById(organisationId, id);
    if (existing && existing.status !== InvitationStatus.PENDING) {
      throw new AppError('Only pending invitations can be revoked', 409, 'INVITATION_NOT_PENDING');
    }
    return this.invitationRepository.updateStatus(organisationId, id, InvitationStatus.REVOKED);
  }

  /** Creates an Invitation: generates+hashes a token and sends the invite email
   *  (identity.md §5). Deferred to the Authentication Layer sprint. */
  create(_organisationId: string, _input: CreateInvitationInput): Promise<never> {
    return notImplemented('InvitationService.create');
  }

  /** Validates a raw invitation token against its stored hash for the pre-acceptance
   *  preview screen (identity.md §10 `GET /invitations/:token`). Deferred. */
  validateToken(_rawToken: string): Promise<never> {
    return notImplemented('InvitationService.validateToken');
  }

  /** Accepts an Invitation: verifies the token, hashes the chosen password, creates the
   *  User, and issues a Session (identity.md §5). Deferred. */
  accept(_rawToken: string, _input: AcceptInvitationInput): Promise<never> {
    return notImplemented('InvitationService.accept');
  }
}

export interface CreateInvitationInput {
  email: string;
  roleId: string;
  invitedById: string;
}

export interface AcceptInvitationInput {
  password: string;
}
