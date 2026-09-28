import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Consumer, ConsumerLocationRequest, ConsumerStatus } from '@prisma/client';
import { RegisterConsumerInput, UpdateConsumerProfileInput } from '@zentuva/validation';

import { normalizePhoneNumber } from '../../notifications/phone-number-normalizer';
import { OrganisationService } from '../../identity/organisation/organisation.service';
import { TerritoryRepository } from '../../retail/territory/territory.repository';
import { ConsumerLocationRequestRepository } from './consumer-location-request.repository';
import { ListConsumersParams, ConsumerRepository } from './consumer.repository';

const CONSUMER_CODE_PREFIX = 'CON';
const CONSUMER_CODE_SEQUENCE_LENGTH = 6;

export interface RegisterConsumerResult {
  consumer: Consumer;
  /** `false` when an existing consumer with this phone number was found
   *  instead of a new row being created — the idempotent-registration
   *  outcome a caller (an admin form, or a future channel adapter) may want
   *  to react to differently (e.g. "welcome back" vs "welcome"). */
  created: boolean;
}

/**
 * Sprint 32 — Consumer Identity, Territory & Location Foundation
 * (docs/domains/d2c.md). THE channel-neutral D2C business service — this
 * class has no knowledge of WhatsApp, HTTP, or any other channel. A future
 * WhatsApp adapter and `ConsumerController` (this sprint's internal/admin
 * HTTP surface) are both expected to be thin callers of the exact same
 * methods here, never reimplementations of this logic (docs/domains/d2c.md
 * §2 "Channel Neutrality").
 *
 * Reuses, rather than duplicates: `normalizePhoneNumber` (Sprint 29, the
 * WhatsApp delivery phone-normalization utility — the same Nigeria-aware
 * rule, not a second implementation), `Territory`/`TerritoryRepository`
 * (Sprint 4.8 — a Consumer's structured location IS a `Territory` row, no
 * second geography model), and `AuditService` (called by the controller,
 * the same "controller records the audit event" convention every other
 * domain in this codebase already uses).
 */
@Injectable()
export class ConsumerService {
  constructor(
    private readonly consumerRepository: ConsumerRepository,
    private readonly locationRequestRepository: ConsumerLocationRequestRepository,
    private readonly territoryRepository: TerritoryRepository,
    private readonly organisationService: OrganisationService,
  ) {}

  getById(organisationId: string, id: string): Promise<Consumer | null> {
    return this.consumerRepository.findById(organisationId, id);
  }

  /** Alias kept distinct from `getById` per the brief's own named service
   *  contract (`getConsumerProfile`) — today it is a pure passthrough, but
   *  keeping the name separate leaves room for a future channel-facing
   *  profile shape (e.g. loyalty points, order history) to diverge from the
   *  internal/admin `getById` read without a breaking rename. */
  getConsumerProfile(organisationId: string, id: string): Promise<Consumer | null> {
    return this.getById(organisationId, id);
  }

  async findConsumerByPhone(
    organisationId: string,
    rawPhoneNumber: string,
  ): Promise<Consumer | null> {
    const organisation = await this.organisationService.getById(organisationId);
    const { normalized } = normalizePhoneNumber(rawPhoneNumber, organisation?.country);
    if (!normalized) {
      return null;
    }
    return this.consumerRepository.findByNormalizedPhone(organisationId, normalized);
  }

  list(organisationId: string, params?: ListConsumersParams): Promise<Consumer[]> {
    return this.consumerRepository.findManyByOrganisation(organisationId, params);
  }

  /**
   * Registers a new consumer, or returns the existing one for this phone
   * number unchanged (docs/domains/d2c.md §8 "Idempotent Registration") —
   * the exact capability the brief names `registerConsumer()`. Phone
   * normalization happens here, once, regardless of caller — this is the
   * only place in the D2C domain a raw phone string is ever turned into the
   * `normalizedPhone` identity key.
   *
   * Throws if the phone cannot be normalized at all (fails closed, matching
   * `normalizePhoneNumber`'s own "fail safely rather than guess" philosophy
   * — extended here from "ineligible for a WhatsApp send" to "cannot become
   * a Consumer's identity key") — `normalizedPhone` is therefore NEVER null,
   * and the `[organisationId, normalizedPhone]` unique constraint is always
   * a real, enforceable dedup guarantee.
   */
  async registerConsumer(
    organisationId: string,
    input: RegisterConsumerInput,
    actorUserId?: string,
  ): Promise<RegisterConsumerResult> {
    const organisation = await this.organisationService.getById(organisationId);
    const { normalized, reason } = normalizePhoneNumber(input.phoneNumber, organisation?.country);
    if (!normalized) {
      throw new BadRequestException(reason ?? 'Phone number could not be normalized');
    }

    if (input.territoryId) {
      await this.assertTerritoryExists(organisationId, input.territoryId);
    }

    const consumerCode = await this.generateUniqueCode();

    const { consumer, created } = await this.consumerRepository.findOrCreate({
      organisationId,
      consumerCode,
      fullName: input.fullName,
      phoneNumber: input.phoneNumber,
      normalizedPhone: normalized,
      email: input.email,
      territoryId: input.territoryId,
      address: input.address,
      marketingOptIn: input.marketingOptIn,
      createdById: actorUserId,
      updatedById: actorUserId,
    });
    return { consumer, created };
  }

  /** Profile-only update — never touches `territoryId` (see
   *  `updateConsumerLocation`) or `phoneNumber` (identity change, out of
   *  scope this sprint). */
  async updateProfile(
    organisationId: string,
    id: string,
    input: UpdateConsumerProfileInput,
    actorUserId?: string,
  ): Promise<Consumer> {
    await this.getByIdOrThrow(organisationId, id);
    const updated = await this.consumerRepository.update(organisationId, id, {
      fullName: input.fullName,
      email: input.email,
      address: input.address,
      marketingOptIn: input.marketingOptIn,
      updatedById: actorUserId,
    });
    if (!updated) {
      throw new NotFoundException('Consumer not found');
    }
    return updated;
  }

  /**
   * The named service contract `updateConsumerLocation()` — a distinct,
   * separately-audited operation from a general profile edit
   * (docs/domains/d2c.md §6), since this is the exact signal a future
   * Collection Point matching system will depend on. `territoryId: null`
   * explicitly clears a previously-selected location.
   */
  async updateConsumerLocation(
    organisationId: string,
    id: string,
    territoryId: string | null,
    actorUserId?: string,
  ): Promise<Consumer> {
    await this.getByIdOrThrow(organisationId, id);
    if (territoryId) {
      await this.assertTerritoryExists(organisationId, territoryId);
    }
    const updated = await this.consumerRepository.update(organisationId, id, {
      territoryId,
      updatedById: actorUserId,
    });
    if (!updated) {
      throw new NotFoundException('Consumer not found');
    }
    return updated;
  }

  async activate(organisationId: string, id: string, actorUserId?: string): Promise<Consumer> {
    const consumer = await this.getByIdOrThrow(organisationId, id);
    if (consumer.status === ConsumerStatus.ACTIVE) {
      throw new BadRequestException('Consumer is already active');
    }
    return this.setStatus(organisationId, id, ConsumerStatus.ACTIVE, actorUserId);
  }

  async suspend(organisationId: string, id: string, actorUserId?: string): Promise<Consumer> {
    const consumer = await this.getByIdOrThrow(organisationId, id);
    if (consumer.status === ConsumerStatus.SUSPENDED) {
      throw new BadRequestException('Consumer is already suspended');
    }
    return this.setStatus(organisationId, id, ConsumerStatus.SUSPENDED, actorUserId);
  }

  async deactivate(organisationId: string, id: string, actorUserId?: string): Promise<Consumer> {
    const consumer = await this.getByIdOrThrow(organisationId, id);
    if (consumer.status === ConsumerStatus.INACTIVE) {
      throw new BadRequestException('Consumer is already inactive');
    }
    return this.setStatus(organisationId, id, ConsumerStatus.INACTIVE, actorUserId);
  }

  /** docs/domains/d2c.md §6 "Non-Existent Location" — a controlled fallback
   *  signal, never an automatic Territory creation. */
  async reportLocationNotFound(
    organisationId: string,
    consumerId: string,
    rawLocationText: string,
  ): Promise<ConsumerLocationRequest> {
    await this.getByIdOrThrow(organisationId, consumerId);
    return this.locationRequestRepository.create({ organisationId, consumerId, rawLocationText });
  }

  listLocationRequests(
    organisationId: string,
    openOnly?: boolean,
  ): Promise<ConsumerLocationRequest[]> {
    return this.locationRequestRepository.list(organisationId, { openOnly });
  }

  async resolveLocationRequest(
    organisationId: string,
    id: string,
    resolvedByUserId: string,
    resolutionNotes?: string,
  ): Promise<{ resolved: boolean }> {
    return this.locationRequestRepository.resolve(
      organisationId,
      id,
      resolvedByUserId,
      resolutionNotes,
    );
  }

  private async setStatus(
    organisationId: string,
    id: string,
    status: ConsumerStatus,
    actorUserId?: string,
  ): Promise<Consumer> {
    const updated = await this.consumerRepository.update(organisationId, id, {
      status,
      updatedById: actorUserId,
    });
    if (!updated) {
      throw new NotFoundException('Consumer not found');
    }
    return updated;
  }

  private async assertTerritoryExists(organisationId: string, territoryId: string): Promise<void> {
    const territory = await this.territoryRepository.findById(organisationId, territoryId);
    if (!territory) {
      throw new BadRequestException('Territory not found');
    }
  }

  private async getByIdOrThrow(organisationId: string, id: string): Promise<Consumer> {
    const consumer = await this.consumerRepository.findById(organisationId, id);
    if (!consumer) {
      throw new NotFoundException('Consumer not found');
    }
    return consumer;
  }

  /** `CON-000001`, `CON-000002`, ... — globally unique, same
   *  collision-avoidance loop as every other auto-numbered entity in this
   *  codebase. */
  private async generateUniqueCode(): Promise<string> {
    let sequence = 1;
    let candidate = formatConsumerCode(sequence);
    while (await this.consumerRepository.existsByCode(candidate)) {
      sequence += 1;
      candidate = formatConsumerCode(sequence);
    }
    return candidate;
  }
}

function formatConsumerCode(sequence: number): string {
  return `${CONSUMER_CODE_PREFIX}-${String(sequence).padStart(CONSUMER_CODE_SEQUENCE_LENGTH, '0')}`;
}
