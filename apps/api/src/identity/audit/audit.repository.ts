import { Injectable } from '@nestjs/common';
import { AuditLog, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

export interface FindAuditLogsParams {
  action?: string;
  entityType?: string;
  from?: Date;
  to?: Date;
  skip?: number;
  take?: number;
}

/**
 * Thin Prisma access for the AuditLog table. Insert-only, per docs/domains/identity.md §4
 * ("Never updated or deleted by application code"). See AuditService.
 */
@Injectable()
export class AuditRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.AuditLogCreateInput): Promise<AuditLog> {
    return this.prisma.auditLog.create({ data });
  }

  findManyByOrganisation(
    organisationId: string,
    params: FindAuditLogsParams = {},
  ): Promise<AuditLog[]> {
    return this.prisma.auditLog.findMany({
      where: {
        organisationId,
        ...(params.action ? { action: params.action } : {}),
        ...(params.entityType ? { entityType: params.entityType } : {}),
        ...(params.from || params.to ? { createdAt: { gte: params.from, lte: params.to } } : {}),
      },
      skip: params.skip,
      take: params.take,
      orderBy: { createdAt: 'desc' },
    });
  }

  countByOrganisation(organisationId: string): Promise<number> {
    return this.prisma.auditLog.count({ where: { organisationId } });
  }
}
