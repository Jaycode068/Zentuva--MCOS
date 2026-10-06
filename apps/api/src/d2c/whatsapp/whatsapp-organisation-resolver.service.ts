import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ConsumerRepository } from '../consumer/consumer.repository';

/**
 * Sprint 40.5 — Real Meta WhatsApp Cloud API Foundation (docs/domains/whatsapp.md
 * "Multi-Tenant Webhook Resolution"). This deployment shares ONE Meta WhatsApp Business
 * phone number across every tenant (a real per-tenant WhatsApp Business Account
 * provisioning flow is out of this sprint's scope) — so an inbound webhook cannot
 * resolve `organisationId` from `metadata.phone_number_id` the way a true multi-number
 * deployment would. This is the one, isolated place that limitation is worked around,
 * never silently assumed anywhere else:
 *
 * - A RETURNING contact (an existing `Consumer` row, in exactly one organisation,
 *   matching the sender's normalized phone) always wins — the normal, unambiguous
 *   case.
 * - A phone number registered as a `Consumer` in MORE THAN ONE organisation is
 *   genuinely ambiguous in a shared-number deployment; this resolves to the most
 *   recently created match rather than failing the whole webhook, logging the
 *   ambiguity so it's visible to an operator. A documented limitation, not a bug — see
 *   docs/sprint-40.5-completion-report.md "Limitations."
 * - A BRAND NEW contact (no existing `Consumer` anywhere) falls back to
 *   `WHATSAPP_DEFAULT_ORGANISATION_ID`, a new, optional, deployment-level config value.
 *   If that is also unset, resolution fails and the caller safely no-ops rather than
 *   guessing.
 */
@Injectable()
export class WhatsAppOrganisationResolverService {
  private readonly logger = new Logger(WhatsAppOrganisationResolverService.name);

  constructor(
    private readonly consumerRepository: ConsumerRepository,
    private readonly config: ConfigService,
  ) {}

  async resolveOrganisationId(normalizedPhone: string): Promise<string | null> {
    const matches =
      await this.consumerRepository.findManyByNormalizedPhoneAcrossOrganisations(normalizedPhone);

    if (matches.length === 1) {
      return matches[0]!.organisationId;
    }
    if (matches.length > 1) {
      const distinctOrgIds = new Set(matches.map((m) => m.organisationId));
      const newest = matches.reduce((latest, m) => (m.createdAt > latest.createdAt ? m : latest));
      this.logger.warn(
        `WhatsApp sender resolves to a Consumer in ${distinctOrgIds.size} different organisations — using the most recently created match. This is a known limitation of this deployment's single shared WhatsApp Business phone number.`,
      );
      return newest.organisationId;
    }

    const defaultOrganisationId = this.config.get<string | undefined>(
      'whatsapp.defaultOrganisationId',
    );
    if (!defaultOrganisationId) {
      this.logger.warn(
        'WhatsApp sender is not a known Consumer in any organisation, and WHATSAPP_DEFAULT_ORGANISATION_ID is not configured — cannot resolve a tenant for this inbound message.',
      );
      return null;
    }
    return defaultOrganisationId;
  }
}
