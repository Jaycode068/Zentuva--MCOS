import { Injectable, NotFoundException } from '@nestjs/common';
import { Supplier } from '@prisma/client';
import { CreateSupplierInput, UpdateSupplierInput } from '@zentuva/validation';

import { ListSuppliersParams, SupplierRepository } from './supplier.repository';

const SUPPLIER_CODE_PREFIX = 'SUP';
const SUPPLIER_CODE_SEQUENCE_LENGTH = 6;

/**
 * Domain service for the Supplier aggregate (Sprint 4.2, docs/domains/suppliers.md).
 * Mirrors `ProductService`'s shape: repository access + business rules (code generation)
 * live here, not in `SupplierController`. Unlike Product, there are no dedicated
 * activate/archive methods — `status` is just another field accepted by {@link update},
 * per the brief's Create/Edit dialog listing "Status" directly.
 */
@Injectable()
export class SupplierService {
  constructor(private readonly supplierRepository: SupplierRepository) {}

  getById(organisationId: string, id: string): Promise<Supplier | null> {
    return this.supplierRepository.findById(organisationId, id);
  }

  list(organisationId: string, params?: ListSuppliersParams): Promise<Supplier[]> {
    return this.supplierRepository.findManyByOrganisation(organisationId, params);
  }

  /** New suppliers default to `ACTIVE` (the Prisma column default) unless the caller
   *  explicitly requests `INACTIVE` on creation. */
  async create(
    organisationId: string,
    input: CreateSupplierInput,
    actorUserId: string,
  ): Promise<Supplier> {
    const supplierCode = await this.generateUniqueCode();

    return this.supplierRepository.create({
      organisation: { connect: { id: organisationId } },
      supplierCode,
      supplierName: input.supplierName,
      displayName: input.displayName,
      contactPerson: input.contactPerson,
      email: input.email || undefined,
      phoneNumber: input.phoneNumber,
      website: input.website || undefined,
      country: input.country,
      state: input.state,
      city: input.city,
      address: input.address,
      taxIdentificationNumber: input.taxIdentificationNumber,
      supplierCategory: input.supplierCategory,
      notes: input.notes,
      ...(input.status ? { status: input.status } : {}),
      createdById: actorUserId,
      updatedById: actorUserId,
    });
  }

  /** Partial update — `supplierCode` is never accepted here (brief: "Must be immutable").
   *  A `status` change (Activate/Deactivate) goes through this same endpoint, unlike
   *  Product's dedicated activate/archive routes — see `SupplierController`'s
   *  `resolveUpdateAuditAction` for how that's still audited as a distinct event. */
  async update(
    organisationId: string,
    id: string,
    input: UpdateSupplierInput,
    actorUserId: string,
  ): Promise<Supplier> {
    const updated = await this.supplierRepository.update(organisationId, id, {
      supplierName: input.supplierName,
      displayName: input.displayName,
      contactPerson: input.contactPerson,
      ...(input.email !== undefined ? { email: input.email || null } : {}),
      phoneNumber: input.phoneNumber,
      ...(input.website !== undefined ? { website: input.website || null } : {}),
      country: input.country,
      state: input.state,
      city: input.city,
      address: input.address,
      taxIdentificationNumber: input.taxIdentificationNumber,
      supplierCategory: input.supplierCategory,
      notes: input.notes,
      status: input.status,
      updatedById: actorUserId,
    });
    if (!updated) {
      throw new NotFoundException('Supplier not found');
    }
    return updated;
  }

  /** `SUP-000001`, `SUP-000002`, ... — globally unique (see `Supplier.supplierCode` schema
   *  comment), same collision-avoidance loop as `ProductService.generateUniqueCode`
   *  (Sprint 4.1). */
  private async generateUniqueCode(): Promise<string> {
    let sequence = 1;
    let candidate = formatSupplierCode(sequence);
    while (await this.supplierRepository.existsByCode(candidate)) {
      sequence += 1;
      candidate = formatSupplierCode(sequence);
    }
    return candidate;
  }
}

function formatSupplierCode(sequence: number): string {
  return `${SUPPLIER_CODE_PREFIX}-${String(sequence).padStart(SUPPLIER_CODE_SEQUENCE_LENGTH, '0')}`;
}
