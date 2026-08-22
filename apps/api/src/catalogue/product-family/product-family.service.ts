import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ProductFamily, ProductFamilyStatus } from '@prisma/client';
import { CreateProductFamilyInput, UpdateProductFamilyInput } from '@zentuva/validation';

import { ListProductFamiliesParams, ProductFamilyRepository } from './product-family.repository';

const PRODUCT_FAMILY_CODE_PREFIX = 'FAM';
const PRODUCT_FAMILY_CODE_SEQUENCE_LENGTH = 6;

/**
 * Domain service for the `ProductFamily` aggregate (Sprint 4.7,
 * docs/domains/catalogue.md). Mirrors `ProductService`'s shape: repository access + the
 * auto-code generator live here, not in `ProductFamilyController`. No status-transition
 * business rules to enforce beyond "don't no-op" — `ACTIVE`/`INACTIVE` never gates a
 * cross-domain rule the way `Product.status` does, so `status` is a plain field on the
 * update payload rather than dedicated activate/deactivate endpoints.
 */
@Injectable()
export class ProductFamilyService {
  constructor(private readonly productFamilyRepository: ProductFamilyRepository) {}

  getById(organisationId: string, id: string): Promise<ProductFamily | null> {
    return this.productFamilyRepository.findById(organisationId, id);
  }

  list(organisationId: string, params?: ListProductFamiliesParams): Promise<ProductFamily[]> {
    return this.productFamilyRepository.findManyByOrganisation(organisationId, params);
  }

  /** New families always start `ACTIVE` — there's no meaningful "draft" phase for a
   *  grouping label, unlike `Product`'s heavier Draft/Active/Archived lifecycle. */
  async create(
    organisationId: string,
    input: CreateProductFamilyInput,
    actorUserId: string,
  ): Promise<ProductFamily> {
    const code = await this.generateUniqueCode();

    return this.productFamilyRepository.create({
      organisation: { connect: { id: organisationId } },
      code,
      name: input.name,
      description: input.description,
      status: ProductFamilyStatus.ACTIVE,
      createdById: actorUserId,
      updatedById: actorUserId,
    });
  }

  /** Partial update — `code` is never accepted here (immutable, same convention as
   *  `Product.code`). */
  async update(
    organisationId: string,
    id: string,
    input: UpdateProductFamilyInput,
    actorUserId: string,
  ): Promise<ProductFamily> {
    const existing = await this.getByIdOrThrow(organisationId, id);

    // Explicit no-op guard, same convention as `ProductService.activate`/`archive`
    // rejecting a transition into the state the row is already in.
    if (input.status !== undefined && existing.status === input.status) {
      throw new BadRequestException(`Product family is already ${input.status.toLowerCase()}`);
    }

    const updated = await this.productFamilyRepository.update(organisationId, id, {
      name: input.name,
      description: input.description,
      status: input.status,
      updatedById: actorUserId,
    });
    if (!updated) {
      throw new NotFoundException('Product family not found');
    }
    return updated;
  }

  private async getByIdOrThrow(organisationId: string, id: string): Promise<ProductFamily> {
    const family = await this.productFamilyRepository.findById(organisationId, id);
    if (!family) {
      throw new NotFoundException('Product family not found');
    }
    return family;
  }

  /** `FAM-000001`, `FAM-000002`, ... — globally unique (see `ProductFamily.code` schema
   *  comment), same collision-avoidance loop as `ProductService.generateUniqueCode`. */
  private async generateUniqueCode(): Promise<string> {
    let sequence = 1;
    let candidate = formatProductFamilyCode(sequence);
    while (await this.productFamilyRepository.existsByCode(candidate)) {
      sequence += 1;
      candidate = formatProductFamilyCode(sequence);
    }
    return candidate;
  }
}

function formatProductFamilyCode(sequence: number): string {
  return `${PRODUCT_FAMILY_CODE_PREFIX}-${String(sequence).padStart(PRODUCT_FAMILY_CODE_SEQUENCE_LENGTH, '0')}`;
}
