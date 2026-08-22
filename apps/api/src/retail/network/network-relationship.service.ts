import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { NetworkRelationshipStatus } from '@prisma/client';
import {
  CreateNetworkRelationshipInput,
  UpdateNetworkRelationshipInput,
} from '@zentuva/validation';

import { CustomerRepository } from '../customer/customer.repository';
import {
  ListNetworkRelationshipsParams,
  NetworkRelationshipRepository,
  NetworkRelationshipWithCustomers,
} from './network-relationship.repository';

/**
 * Domain service for the `DistributionNetworkRelationship` aggregate (Sprint 4.8,
 * docs/domains/retail-network.md) — THE keystone of "capture the market first, structure
 * the network progressively."
 *
 * A relationship is entirely optional intelligence/coordination data. Nothing in this
 * file — and, by construction, nothing in `SalesModule`, which never imports this module
 * — ever consults a relationship to decide whether a `SalesOrder` may be created.
 */
@Injectable()
export class NetworkRelationshipService {
  constructor(
    private readonly networkRelationshipRepository: NetworkRelationshipRepository,
    private readonly customerRepository: CustomerRepository,
  ) {}

  getById(organisationId: string, id: string): Promise<NetworkRelationshipWithCustomers | null> {
    return this.networkRelationshipRepository.findById(organisationId, id);
  }

  list(
    organisationId: string,
    params?: ListNetworkRelationshipsParams,
  ): Promise<NetworkRelationshipWithCustomers[]> {
    return this.networkRelationshipRepository.findManyByOrganisation(organisationId, params);
  }

  /** New relationships always start `ACTIVE`. Rejects: a customer supplying itself, a
   *  source/target that doesn't exist or belongs to a different organisation (a
   *  cross-org id simply resolves to `null` from the tenant-scoped lookup — this IS the
   *  same-organisation enforcement), and a duplicate already-`ACTIVE` (source, target,
   *  type) triple. */
  async create(
    organisationId: string,
    input: CreateNetworkRelationshipInput,
    actorUserId: string,
  ): Promise<NetworkRelationshipWithCustomers> {
    if (input.sourceCustomerId === input.targetCustomerId) {
      throw new BadRequestException('A customer cannot supply itself');
    }
    await this.assertCustomerExists(organisationId, input.sourceCustomerId, 'Source customer');
    await this.assertCustomerExists(organisationId, input.targetCustomerId, 'Target customer');

    const duplicate = await this.networkRelationshipRepository.findActiveDuplicate(
      organisationId,
      input.sourceCustomerId,
      input.targetCustomerId,
      input.relationshipType,
    );
    if (duplicate) {
      throw new BadRequestException('This relationship is already active');
    }

    return this.networkRelationshipRepository.create({
      organisation: { connect: { id: organisationId } },
      sourceCustomer: { connect: { id: input.sourceCustomerId } },
      targetCustomer: { connect: { id: input.targetCustomerId } },
      relationshipType: input.relationshipType,
      effectiveFrom: input.effectiveFrom ?? new Date(),
      effectiveTo: input.effectiveTo,
      notes: input.notes,
      status: NetworkRelationshipStatus.ACTIVE,
      createdById: actorUserId,
      updatedById: actorUserId,
    });
  }

  /** Partial update — `sourceCustomerId`/`targetCustomerId`/`relationshipType` are
   *  deliberately absent: changing an endpoint would rewrite the network's history.
   *  Deactivate this relationship and create a new one instead. */
  async update(
    organisationId: string,
    id: string,
    input: UpdateNetworkRelationshipInput,
    actorUserId: string,
  ): Promise<NetworkRelationshipWithCustomers> {
    await this.getByIdOrThrow(organisationId, id);

    const updated = await this.networkRelationshipRepository.update(organisationId, id, {
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo,
      notes: input.notes,
      updatedById: actorUserId,
    });
    if (!updated) {
      throw new NotFoundException('Network relationship not found');
    }
    return updated;
  }

  /** Sets `status: INACTIVE` and stamps `effectiveTo` to now if it wasn't already set —
   *  never deletes the row, so the relationship's full history remains queryable. */
  async deactivate(
    organisationId: string,
    id: string,
    actorUserId: string,
  ): Promise<NetworkRelationshipWithCustomers> {
    const existing = await this.getByIdOrThrow(organisationId, id);
    if (existing.status === NetworkRelationshipStatus.INACTIVE) {
      throw new BadRequestException('Network relationship is already inactive');
    }

    const updated = await this.networkRelationshipRepository.update(organisationId, id, {
      status: NetworkRelationshipStatus.INACTIVE,
      effectiveTo: existing.effectiveTo ?? new Date(),
      updatedById: actorUserId,
    });
    if (!updated) {
      throw new NotFoundException('Network relationship not found');
    }
    return updated;
  }

  private async assertCustomerExists(
    organisationId: string,
    customerId: string,
    label: string,
  ): Promise<void> {
    const customer = await this.customerRepository.findById(organisationId, customerId);
    if (!customer) {
      throw new BadRequestException(`${label} not found`);
    }
  }

  private async getByIdOrThrow(
    organisationId: string,
    id: string,
  ): Promise<NetworkRelationshipWithCustomers> {
    const relationship = await this.networkRelationshipRepository.findById(organisationId, id);
    if (!relationship) {
      throw new NotFoundException('Network relationship not found');
    }
    return relationship;
  }
}
