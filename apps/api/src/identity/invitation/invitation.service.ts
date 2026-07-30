import { Injectable } from '@nestjs/common';
import { Invitation, InvitationStatus } from '@prisma/client';
import { AppError } from '@zentuva/utils';

import { hashToken } from '../auth/common/token-hash.util';
import { notImplemented } from '../common/not-implemented';
import { InvitationRepository } from './invitation.repository';

/**
 * Domain service for the Invitation aggregate.
 *
 * Sprint 1B.2 note: `validateToken` is now implemented for real (token lookup + expiry/
 * status checks — no password hashing, no User creation). `accept` stays narrowly scoped
 * to marking the Invitation row `ACCEPTED`; creating the User (UserService), assigning
 * the Role (RoleService), and issuing a Session (SessionStore) are AuthService's job to
 * orchestrate — see docs/sprint-1B.2-completion-report.md. `create` (generating + emailing
 * an invitation) stays a stub — invitation *creation* was never in this sprint's scope,
 * only *acceptance*.
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

  /** Validates a raw invitation token: exists, still PENDING, not expired
   *  (identity.md §5 Invitation Flow, §10 `GET /invitations/:token`). Throws otherwise. */
  async validateToken(rawToken: string): Promise<Invitation> {
    const invitation = await this.invitationRepository.findByTokenHash(hashToken(rawToken));
    if (!invitation) {
      throw new AppError('Invitation not found', 404, 'INVITATION_NOT_FOUND');
    }
    if (invitation.status !== InvitationStatus.PENDING) {
      throw new AppError('Invitation is no longer pending', 409, 'INVITATION_NOT_PENDING');
    }
    if (invitation.expiresAt.getTime() < Date.now()) {
      throw new AppError('Invitation has expired', 410, 'INVITATION_EXPIRED');
    }
    return invitation;
  }

  /** Marks an already-validated Invitation as accepted. Does not create the User or
   *  assign the Role — see class-level note. */
  markAccepted(organisationId: string, id: string): Promise<Invitation> {
    return this.invitationRepository.updateStatus(organisationId, id, InvitationStatus.ACCEPTED, {
      acceptedAt: new Date(),
    });
  }

  /** Creates an Invitation: generates+hashes a token and sends the invite email
   *  (identity.md §5). Invitation *creation* was never in Sprint 1B.2's scope (only
   *  *acceptance*) — deferred. */
  create(_organisationId: string, _input: CreateInvitationInput): Promise<never> {
    return notImplemented('InvitationService.create');
  }
}

export interface CreateInvitationInput {
  email: string;
  roleId: string;
  invitedById: string;
}
