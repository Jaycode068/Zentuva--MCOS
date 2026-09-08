import { Injectable } from '@nestjs/common';
import {
  MaintenanceDocument,
  MaintenanceDocumentEntityType,
  MaintenanceDocumentType,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

export interface CreateMaintenanceDocumentData {
  organisationId: string;
  entityType: MaintenanceDocumentEntityType;
  entityId: string;
  documentType: MaintenanceDocumentType;
  url: string;
  key: string;
  fileName?: string;
  caption?: string;
  createdById: string;
}

/**
 * Thin Prisma access for `MaintenanceDocument` (Sprint 21, docs/domains/
 * maintenance.md) — the `AssetDocument`/`CreditNote.sourceType` shape,
 * one row per attached file, insert/delete only.
 */
@Injectable()
export class MaintenanceDocumentRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(organisationId: string, id: string): Promise<MaintenanceDocument | null> {
    return this.prisma.maintenanceDocument.findFirst({ where: { id, organisationId } });
  }

  findManyByEntity(
    organisationId: string,
    entityType: MaintenanceDocumentEntityType,
    entityId: string,
  ): Promise<MaintenanceDocument[]> {
    return this.prisma.maintenanceDocument.findMany({
      where: { organisationId, entityType, entityId },
      orderBy: { createdAt: 'desc' },
    });
  }

  create(data: CreateMaintenanceDocumentData): Promise<MaintenanceDocument> {
    return this.prisma.maintenanceDocument.create({
      data: {
        organisationId: data.organisationId,
        entityType: data.entityType,
        entityId: data.entityId,
        documentType: data.documentType,
        url: data.url,
        key: data.key,
        fileName: data.fileName,
        caption: data.caption,
        createdById: data.createdById,
      },
    });
  }

  async remove(organisationId: string, id: string): Promise<boolean> {
    const result = await this.prisma.maintenanceDocument.deleteMany({
      where: { id, organisationId },
    });
    return result.count > 0;
  }
}
