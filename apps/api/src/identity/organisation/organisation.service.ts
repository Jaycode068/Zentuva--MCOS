import { Injectable } from '@nestjs/common';
import { Organisation, Prisma } from '@prisma/client';

import { notImplemented } from '../common/not-implemented';
import { OrganisationRepository } from './organisation.repository';

/**
 * Domain service for the Organisation aggregate.
 *
 * Sprint 1B.1 scope note: methods that are pure reads or plain data mutations with no
 * authentication/authorization concerns are implemented for real (delegating to the
 * repository). `register` spans multiple aggregates and requires password hashing —
 * that's authentication-adjacent and explicitly out of scope this sprint, so it's a
 * signature-only stub. See docs/sprint-1B.1-completion-report.md.
 */
@Injectable()
export class OrganisationService {
  constructor(private readonly organisationRepository: OrganisationRepository) {}

  getById(id: string): Promise<Organisation | null> {
    return this.organisationRepository.findById(id);
  }

  getBySlug(slug: string): Promise<Organisation | null> {
    return this.organisationRepository.findBySlug(slug);
  }

  updateProfile(id: string, input: UpdateOrganisationProfileInput): Promise<Organisation> {
    return this.organisationRepository.updateProfile(id, {
      ...input,
      settings: input.settings as Prisma.InputJsonValue | undefined,
    });
  }

  suspend(id: string): Promise<Organisation> {
    return this.organisationRepository.updateStatus(id, 'SUSPENDED');
  }

  reactivate(id: string): Promise<Organisation> {
    return this.organisationRepository.updateStatus(id, 'ACTIVE');
  }

  close(id: string): Promise<Organisation> {
    return this.organisationRepository.updateStatus(id, 'CLOSED');
  }

  /**
   * Self-service Organisation Registration (identity.md §3/§5/§11): creates the
   * Organisation, seeds its system roles, creates the first (Owner) User, and issues a
   * session. Requires password hashing, an organisationCode generation strategy, and a
   * cross-aggregate transaction — deferred to the Authentication Layer sprint.
   */
  register(_input: RegisterOrganisationInput): Promise<never> {
    return notImplemented('OrganisationService.register');
  }
}

export interface UpdateOrganisationProfileInput {
  name?: string;
  logoUrl?: string;
  description?: string;
  industry?: string;
  businessType?: string;
  phone?: string;
  website?: string;
  supportEmail?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  currency?: string;
  timeZone?: string;
  fiscalYearStart?: number;
  dateFormat?: string;
  settings?: Record<string, unknown>;
}

export interface RegisterOrganisationInput {
  organisationName: string;
  businessEmail: string;
  country: string;
  adminFirstName: string;
  adminLastName: string;
  adminEmail: string;
  password: string;
}
