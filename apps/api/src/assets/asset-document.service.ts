import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AssetDocument, AssetDocumentType } from '@prisma/client';

import { FILE_STORAGE, FileStorage } from '../identity/organisation/ports/file-storage.port';
import { AssetDocumentRepository } from './asset-document.repository';
import { AssetRepository } from './asset.repository';

/** Domain service for `AssetDocument` (Sprint 20, docs/domains/assets.md)
 *  — the general multi-file case (invoices, warranty docs, manuals,
 *  certificates, extra photos). Reuses the shared `FileStorage` port
 *  exactly like `Asset.imageUrl`/`imageKey`'s own upload path. */
@Injectable()
export class AssetDocumentService {
  constructor(
    private readonly assetDocumentRepository: AssetDocumentRepository,
    private readonly assetRepository: AssetRepository,
    @Inject(FILE_STORAGE) private readonly fileStorage: FileStorage,
  ) {}

  list(organisationId: string, assetId: string): Promise<AssetDocument[]> {
    return this.assetDocumentRepository.findManyByAsset(organisationId, assetId);
  }

  async add(
    organisationId: string,
    assetId: string,
    documentType: AssetDocumentType,
    file: { mimeType: string; buffer: Buffer; originalName?: string },
    caption: string | undefined,
    actorUserId: string,
  ): Promise<AssetDocument> {
    const asset = await this.assetRepository.findById(organisationId, assetId);
    if (!asset) {
      throw new NotFoundException('Asset not found');
    }

    const uploaded = await this.fileStorage.upload({
      organisationId,
      folder: 'asset-documents',
      mimeType: file.mimeType,
      buffer: file.buffer,
    });

    return this.assetDocumentRepository.create({
      organisationId,
      assetId,
      documentType,
      url: uploaded.url,
      key: uploaded.key,
      fileName: file.originalName,
      caption,
      createdById: actorUserId,
    });
  }

  async remove(organisationId: string, assetId: string, documentId: string): Promise<void> {
    const document = await this.assetDocumentRepository.findById(organisationId, documentId);
    if (!document || document.assetId !== assetId) {
      throw new NotFoundException('Asset document not found');
    }
    const removed = await this.assetDocumentRepository.remove(organisationId, documentId);
    if (!removed) {
      throw new NotFoundException('Asset document not found');
    }
    await this.fileStorage.delete(document.key).catch(() => undefined);
  }
}
