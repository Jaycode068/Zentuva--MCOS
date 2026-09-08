import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  MaintenanceDocument,
  MaintenanceDocumentEntityType,
  MaintenanceDocumentType,
} from '@prisma/client';

import { FILE_STORAGE, FileStorage } from '../identity/organisation/ports/file-storage.port';
import { MaintenanceDocumentRepository } from './maintenance-document.repository';

/**
 * Domain service for `MaintenanceDocument` (Sprint 21, docs/domains/
 * maintenance.md) — before/after photos and supporting files attached to
 * a `MaintenanceRequest` or `WorkOrder`, via the same shared `FileStorage`
 * port every other file-attachment in this codebase already uses.
 */
@Injectable()
export class MaintenanceDocumentService {
  constructor(
    private readonly maintenanceDocumentRepository: MaintenanceDocumentRepository,
    @Inject(FILE_STORAGE) private readonly fileStorage: FileStorage,
  ) {}

  list(
    organisationId: string,
    entityType: MaintenanceDocumentEntityType,
    entityId: string,
  ): Promise<MaintenanceDocument[]> {
    return this.maintenanceDocumentRepository.findManyByEntity(
      organisationId,
      entityType,
      entityId,
    );
  }

  async add(
    organisationId: string,
    entityType: MaintenanceDocumentEntityType,
    entityId: string,
    documentType: MaintenanceDocumentType,
    file: { mimeType: string; buffer: Buffer; originalName?: string },
    caption: string | undefined,
    actorUserId: string,
  ): Promise<MaintenanceDocument> {
    const uploaded = await this.fileStorage.upload({
      organisationId,
      folder: 'maintenance',
      mimeType: file.mimeType,
      buffer: file.buffer,
    });

    return this.maintenanceDocumentRepository.create({
      organisationId,
      entityType,
      entityId,
      documentType,
      url: uploaded.url,
      key: uploaded.key,
      fileName: file.originalName,
      caption,
      createdById: actorUserId,
    });
  }

  async remove(organisationId: string, id: string): Promise<void> {
    const document = await this.maintenanceDocumentRepository.findById(organisationId, id);
    if (!document) {
      throw new NotFoundException('Document not found');
    }
    const removed = await this.maintenanceDocumentRepository.remove(organisationId, id);
    if (!removed) {
      throw new NotFoundException('Document not found');
    }
    await this.fileStorage.delete(document.key).catch(() => undefined);
  }
}
