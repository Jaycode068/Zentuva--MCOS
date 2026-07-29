import { Injectable } from '@nestjs/common';
import { AuditLog, Prisma } from '@prisma/client';

import { AuditRepository, FindAuditLogsParams } from './audit.repository';

/**
 * Domain service for the AuditLog table. Pure insert/read — no authentication or
 * business logic involved, so this is the one service implemented in full this sprint.
 * Every future domain (not just Identity) is expected to call `record` — see
 * docs/domains/identity.md §8.
 */
@Injectable()
export class AuditService {
  constructor(private readonly auditRepository: AuditRepository) {}

  record(event: RecordAuditEventInput): Promise<AuditLog> {
    return this.auditRepository.create({
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId,
      metadata: (event.metadata ?? {}) as Prisma.InputJsonValue,
      ipAddress: event.ipAddress,
      userAgent: event.userAgent,
      ...(event.organisationId ? { organisation: { connect: { id: event.organisationId } } } : {}),
      ...(event.actorUserId ? { actorUserId: event.actorUserId } : {}),
    });
  }

  listByOrganisation(organisationId: string, params?: FindAuditLogsParams): Promise<AuditLog[]> {
    return this.auditRepository.findManyByOrganisation(organisationId, params);
  }

  countByOrganisation(organisationId: string): Promise<number> {
    return this.auditRepository.countByOrganisation(organisationId);
  }
}

export interface RecordAuditEventInput {
  action: string;
  entityType: string;
  entityId?: string;
  organisationId?: string;
  actorUserId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}
