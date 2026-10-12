import { Injectable } from '@nestjs/common';
import { InventoryLocation, LocationStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_LOCATION_NAME = 'Main Warehouse';

export type InventoryLocationWithProductCount = InventoryLocation & {
  productCount: number;
};

/**
 * Thin Prisma access for the `InventoryLocation` aggregate (Sprint 4.5,
 * docs/domains/inventory.md "Stock Locations"). No delete — same "deactivate, never
 * remove" convention as `SupplierRepository`/`ProductRepository`.
 */
@Injectable()
export class InventoryLocationRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.InventoryLocationCreateInput): Promise<InventoryLocation> {
    return this.prisma.inventoryLocation.create({ data });
  }

  findById(organisationId: string, id: string): Promise<InventoryLocation | null> {
    return this.prisma.inventoryLocation.findFirst({ where: { id, organisationId } });
  }

  async findManyByOrganisation(
    organisationId: string,
  ): Promise<InventoryLocationWithProductCount[]> {
    const rows = await this.prisma.inventoryLocation.findMany({
      where: { organisationId },
      include: { _count: { select: { stock: true } } },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
    return rows.map((row) => ({ ...row, productCount: row._count.stock }));
  }

  async update(
    organisationId: string,
    id: string,
    data: Prisma.InventoryLocationUncheckedUpdateManyInput,
  ): Promise<InventoryLocation | null> {
    const result = await this.prisma.inventoryLocation.updateMany({
      where: { id, organisationId },
      data,
    });
    if (result.count === 0) {
      return null;
    }
    return this.prisma.inventoryLocation.findUniqueOrThrow({ where: { id } });
  }

  /** Added Phase 2A — Customer-Location Inventory Foundation
   *  (docs/customer-location-inventory-architecture-audit.md §7/§10). A narrow, direct,
   *  read-only `Outlet` existence check — reading another domain's table directly
   *  rather than importing `OutletModule`, the same "documented exception" pattern
   *  `SalesPerformanceReportService` already uses for `SalesOrder` (the alternative,
   *  importing `OutletModule` here, would create the first circular module dependency
   *  in this codebase, since `OutletModule` already imports `InventoryModule`).
   *  Tenant-scoped: an outlet belonging to another organisation is indistinguishable
   *  from a nonexistent one. */
  async outletExists(organisationId: string, outletId: string): Promise<boolean> {
    const count = await this.prisma.outlet.count({ where: { id: outletId, organisationId } });
    return count > 0;
  }

  /** Added Phase 2B (brief §4: "Do not create duplicate locations for an Outlet") — a
   *  friendly, UX-only pre-check so a duplicate attempt gets a clear `400` instead of
   *  a raw constraint-violation `500`; the database's own `@@unique([outletId])` is
   *  the true authority against a concurrent race. */
  findByOutletId(organisationId: string, outletId: string): Promise<InventoryLocation | null> {
    return this.prisma.inventoryLocation.findFirst({ where: { organisationId, outletId } });
  }

  /** Every organisation needs exactly one default location for Goods Receiving/Stock
   *  Adjustments to fall back to when the caller doesn't specify one (brief §17: "Do
   *  not break the existing Goods Receiving flow"). Rather than hooking this into
   *  organisation registration (a cross-domain change outside Inventory's own
   *  ownership — ADR-002), it's created lazily, on first use, the first time any
   *  organisation actually needs one. Idempotent: a second call finds the
   *  already-created row instead of creating a duplicate. */
  async getOrCreateDefault(
    organisationId: string,
    actorUserId?: string,
  ): Promise<InventoryLocation> {
    const existing = await this.prisma.inventoryLocation.findFirst({
      where: { organisationId, isDefault: true },
    });
    if (existing) {
      return existing;
    }
    return this.prisma.inventoryLocation.create({
      data: {
        organisationId,
        name: DEFAULT_LOCATION_NAME,
        status: LocationStatus.ACTIVE,
        isDefault: true,
        createdById: actorUserId,
        updatedById: actorUserId,
      },
    });
  }
}
