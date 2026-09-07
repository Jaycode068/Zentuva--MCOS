import { Injectable } from '@nestjs/common';
import { AssetDocument, AssetDocumentType } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

export interface CreateAssetDocumentData {
  organisationId: string;
  assetId: string;
  documentType: AssetDocumentType;
  url: string;
  key: string;
  fileName?: string;
  caption?: string;
  createdById: string;
}

/**
 * Thin Prisma access for `AssetDocument` (Sprint 20, docs/domains/
 * assets.md) — the `OutletPhoto` shape (Sprint 4.8), one row per
 * attached file. Insert/delete only, like every file-reference row in
 * this codebase — a re-upload is simply a new row, never an update.
 */
@Injectable()
export class AssetDocumentRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(organisationId: string, id: string): Promise<AssetDocument | null> {
    return this.prisma.assetDocument.findFirst({ where: { id, organisationId } });
  }

  findManyByAsset(organisationId: string, assetId: string): Promise<AssetDocument[]> {
    return this.prisma.assetDocument.findMany({
      where: { organisationId, assetId },
      orderBy: { createdAt: 'desc' },
    });
  }

  create(data: CreateAssetDocumentData): Promise<AssetDocument> {
    return this.prisma.assetDocument.create({
      data: {
        organisationId: data.organisationId,
        assetId: data.assetId,
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
    const result = await this.prisma.assetDocument.deleteMany({ where: { id, organisationId } });
    return result.count > 0;
  }
}
