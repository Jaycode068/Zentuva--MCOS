import { Injectable } from '@nestjs/common';
import { ConsumerLocationRequest } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

export interface CreateConsumerLocationRequestData {
  organisationId: string;
  consumerId: string;
  rawLocationText: string;
}

/**
 * Thin Prisma access for the `ConsumerLocationRequest` aggregate (Sprint 32,
 * docs/domains/d2c.md §6 "Non-Existent Location"). No business logic — see
 * `ConsumerService`.
 */
@Injectable()
export class ConsumerLocationRequestRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: CreateConsumerLocationRequestData): Promise<ConsumerLocationRequest> {
    return this.prisma.consumerLocationRequest.create({ data });
  }

  findById(organisationId: string, id: string): Promise<ConsumerLocationRequest | null> {
    return this.prisma.consumerLocationRequest.findFirst({ where: { id, organisationId } });
  }

  /** `openOnly` defaults `true` — the admin-visible worklist (brief §6:
   *  "make it visible to internal users/admins later") is naturally
   *  open-requests-first; pass `false` to see the full history. */
  list(
    organisationId: string,
    params: { openOnly?: boolean } = {},
  ): Promise<ConsumerLocationRequest[]> {
    const openOnly = params.openOnly ?? true;
    return this.prisma.consumerLocationRequest.findMany({
      where: {
        organisationId,
        ...(openOnly ? { resolvedAt: null } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Conditional `updateMany` (never a blind `update`) — an already-resolved
   *  request cannot be "resolved" a second time, and a cross-tenant id
   *  structurally cannot match, same convention as every status transition
   *  in this codebase. */
  async resolve(
    organisationId: string,
    id: string,
    resolvedByUserId: string,
    resolutionNotes?: string,
  ): Promise<{ resolved: boolean }> {
    const result = await this.prisma.consumerLocationRequest.updateMany({
      where: { id, organisationId, resolvedAt: null },
      data: { resolvedAt: new Date(), resolvedByUserId, resolutionNotes },
    });
    return { resolved: result.count > 0 };
  }
}
