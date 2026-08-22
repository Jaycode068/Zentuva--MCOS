import { Injectable } from '@nestjs/common';
import { OutletPhoto, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

/**
 * Thin Prisma access for the `OutletPhoto` child aggregate (Sprint 4.8,
 * docs/domains/outlets.md) — the first multi-file-per-entity model in this codebase. The
 * `FileStorage` port itself is untouched; `OutletService` calls `FileStorage.upload` once
 * per file and writes one row here per result.
 */
@Injectable()
export class OutletPhotoRepository {
  constructor(private readonly prisma: PrismaService) {}

  addPhoto(data: Prisma.OutletPhotoCreateInput): Promise<OutletPhoto> {
    return this.prisma.outletPhoto.create({ data });
  }

  listByOutlet(organisationId: string, outletId: string): Promise<OutletPhoto[]> {
    return this.prisma.outletPhoto.findMany({
      where: { organisationId, outletId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Tenant-scoped findFirst-then-delete — returns the deleted row (so the caller can
   *  read its `key` and delete the underlying file) or `null` if it doesn't exist/belong
   *  to a different organisation or outlet. */
  async removePhoto(
    organisationId: string,
    outletId: string,
    photoId: string,
  ): Promise<OutletPhoto | null> {
    const photo = await this.prisma.outletPhoto.findFirst({
      where: { id: photoId, organisationId, outletId },
    });
    if (!photo) {
      return null;
    }
    await this.prisma.outletPhoto.delete({ where: { id: photoId } });
    return photo;
  }
}
