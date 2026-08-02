import { Injectable } from '@nestjs/common';
import { Prisma, Supplier, SupplierCategory, SupplierStatus } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

export interface ListSuppliersParams {
  status?: SupplierStatus;
  category?: SupplierCategory;
  /** Simple case-insensitive substring match against name, code, or contact person
   *  (Sprint 4.2 brief: "Support Search... No pagination" — same convention as
   *  `ProductRepository.findManyByOrganisation`). */
  search?: string;
}

/**
 * Thin Prisma access for the Supplier aggregate. No business logic — see SupplierService
 * and docs/domains/suppliers.md.
 *
 * Tenant-safety convention (matches `ProductRepository`/`UserRepository`, identity.md §7):
 * every method that reads or writes a specific supplier takes `organisationId` and
 * includes it in the query, even though `id` alone is a globally unique cuid.
 */
@Injectable()
export class SupplierRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.SupplierCreateInput): Promise<Supplier> {
    return this.prisma.supplier.create({ data });
  }

  findById(organisationId: string, id: string): Promise<Supplier | null> {
    return this.prisma.supplier.findFirst({ where: { id, organisationId } });
  }

  findManyByOrganisation(
    organisationId: string,
    params: ListSuppliersParams = {},
  ): Promise<Supplier[]> {
    return this.prisma.supplier.findMany({
      where: {
        organisationId,
        ...(params.status ? { status: params.status } : {}),
        ...(params.category ? { supplierCategory: params.category } : {}),
        ...(params.search
          ? {
              OR: [
                { supplierName: { contains: params.search, mode: 'insensitive' } },
                { supplierCode: { contains: params.search, mode: 'insensitive' } },
                { contactPerson: { contains: params.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Globally unique (see `Supplier.supplierCode` schema comment) — checked without an
   *  `organisationId` filter, unlike every other lookup on this repository. */
  async existsByCode(supplierCode: string): Promise<boolean> {
    const count = await this.prisma.supplier.count({ where: { supplierCode } });
    return count > 0;
  }

  async update(
    organisationId: string,
    id: string,
    data: Prisma.SupplierUpdateInput,
  ): Promise<Supplier | null> {
    const result = await this.prisma.supplier.updateMany({
      where: { id, organisationId },
      data,
    });
    if (result.count === 0) {
      return null;
    }
    return this.prisma.supplier.findUniqueOrThrow({ where: { id } });
  }
}
