import { Injectable } from '@nestjs/common';
import {
  DistributionNetworkRelationship,
  DistributionRelationshipType,
  NetworkRelationshipStatus,
  Prisma,
} from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

export interface ListNetworkRelationshipsParams {
  status?: NetworkRelationshipStatus;
  /** Matches a customer appearing as either the source or the target. */
  customerId?: string;
  relationshipType?: DistributionRelationshipType;
}

export type NetworkRelationshipWithCustomers = DistributionNetworkRelationship & {
  sourceCustomer: { id: string; customerCode: string; customerName: string; customerType: string };
  targetCustomer: { id: string; customerCode: string; customerName: string; customerType: string };
};

const RELATIONS_INCLUDE = {
  sourceCustomer: {
    select: { id: true, customerCode: true, customerName: true, customerType: true },
  },
  targetCustomer: {
    select: { id: true, customerCode: true, customerName: true, customerType: true },
  },
};

/**
 * Thin Prisma access for the `DistributionNetworkRelationship` aggregate (Sprint 4.8,
 * docs/domains/retail-network.md). No business logic — see `NetworkRelationshipService`.
 *
 * Tenant-safety convention (matches every other repository in this codebase): every
 * method that reads or writes a specific relationship takes `organisationId` and includes
 * it in the query.
 */
@Injectable()
export class NetworkRelationshipRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(
    data: Prisma.DistributionNetworkRelationshipCreateInput,
  ): Promise<NetworkRelationshipWithCustomers> {
    return this.prisma.distributionNetworkRelationship.create({ data, include: RELATIONS_INCLUDE });
  }

  findById(organisationId: string, id: string): Promise<NetworkRelationshipWithCustomers | null> {
    return this.prisma.distributionNetworkRelationship.findFirst({
      where: { id, organisationId },
      include: RELATIONS_INCLUDE,
    });
  }

  findManyByOrganisation(
    organisationId: string,
    params: ListNetworkRelationshipsParams = {},
  ): Promise<NetworkRelationshipWithCustomers[]> {
    return this.prisma.distributionNetworkRelationship.findMany({
      where: {
        organisationId,
        ...(params.status ? { status: params.status } : {}),
        ...(params.relationshipType ? { relationshipType: params.relationshipType } : {}),
        ...(params.customerId
          ? {
              OR: [
                { sourceCustomerId: params.customerId },
                { targetCustomerId: params.customerId },
              ],
            }
          : {}),
      },
      include: RELATIONS_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Used by the service to reject a duplicate ACTIVE relationship — deliberately no
   *  `@@unique` constraint on this tuple, since a lapsed relationship must remain
   *  re-establishable as a new row (see the model's schema comment). */
  findActiveDuplicate(
    organisationId: string,
    sourceCustomerId: string,
    targetCustomerId: string,
    relationshipType: DistributionRelationshipType,
  ): Promise<DistributionNetworkRelationship | null> {
    return this.prisma.distributionNetworkRelationship.findFirst({
      where: {
        organisationId,
        sourceCustomerId,
        targetCustomerId,
        relationshipType,
        status: NetworkRelationshipStatus.ACTIVE,
      },
    });
  }

  async update(
    organisationId: string,
    id: string,
    data: Prisma.DistributionNetworkRelationshipUpdateInput,
  ): Promise<NetworkRelationshipWithCustomers | null> {
    const result = await this.prisma.distributionNetworkRelationship.updateMany({
      where: { id, organisationId },
      data,
    });
    if (result.count === 0) {
      return null;
    }
    return this.prisma.distributionNetworkRelationship.findUniqueOrThrow({
      where: { id },
      include: RELATIONS_INCLUDE,
    });
  }
}
