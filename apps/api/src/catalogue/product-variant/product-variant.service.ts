import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ProductVariant, ProductVariantStatus } from '@prisma/client';
import { CreateProductVariantInput, UpdateProductVariantInput } from '@zentuva/validation';

import { ProductFamilyRepository } from '../product-family/product-family.repository';
import { ListProductVariantsParams, ProductVariantRepository } from './product-variant.repository';

const PRODUCT_VARIANT_CODE_PREFIX = 'VAR';
const PRODUCT_VARIANT_CODE_SEQUENCE_LENGTH = 6;

/**
 * Domain service for the `ProductVariant` aggregate (Sprint 4.7,
 * docs/domains/catalogue.md). Mirrors `ProductFamilyService`'s shape, plus the one real
 * business rule this aggregate adds: a variant can never be created (or exist) without a
 * parent family that's real and belongs to the same organisation — validated here, the
 * same "second line of defense behind the frontend's filtered picker" pattern
 * `BillOfMaterialService.assertFinishedProduct` uses for `Product`.
 */
@Injectable()
export class ProductVariantService {
  constructor(
    private readonly productVariantRepository: ProductVariantRepository,
    private readonly productFamilyRepository: ProductFamilyRepository,
  ) {}

  getById(organisationId: string, id: string): Promise<ProductVariant | null> {
    return this.productVariantRepository.findById(organisationId, id);
  }

  list(organisationId: string, params?: ListProductVariantsParams): Promise<ProductVariant[]> {
    return this.productVariantRepository.findManyByOrganisation(organisationId, params);
  }

  /** New variants always start `ACTIVE` — same rationale as `ProductFamilyService.create`. */
  async create(
    organisationId: string,
    input: CreateProductVariantInput,
    actorUserId: string,
  ): Promise<ProductVariant> {
    await this.assertFamilyExists(organisationId, input.productFamilyId);
    const code = await this.generateUniqueCode();

    return this.productVariantRepository.create({
      organisation: { connect: { id: organisationId } },
      productFamily: { connect: { id: input.productFamilyId } },
      code,
      name: input.name,
      description: input.description,
      status: ProductVariantStatus.ACTIVE,
      createdById: actorUserId,
      updatedById: actorUserId,
    });
  }

  /** Partial update — `code`/`productFamilyId` are never accepted here (immutable this
   *  sprint — no re-parenting a variant to a different family). */
  async update(
    organisationId: string,
    id: string,
    input: UpdateProductVariantInput,
    actorUserId: string,
  ): Promise<ProductVariant> {
    const existing = await this.getByIdOrThrow(organisationId, id);

    if (input.status !== undefined && existing.status === input.status) {
      throw new BadRequestException(`Product variant is already ${input.status.toLowerCase()}`);
    }

    const updated = await this.productVariantRepository.update(organisationId, id, {
      name: input.name,
      description: input.description,
      status: input.status,
      updatedById: actorUserId,
    });
    if (!updated) {
      throw new NotFoundException('Product variant not found');
    }
    return updated;
  }

  private async assertFamilyExists(organisationId: string, productFamilyId: string): Promise<void> {
    const family = await this.productFamilyRepository.findById(organisationId, productFamilyId);
    if (!family) {
      throw new BadRequestException('Product family not found');
    }
  }

  private async getByIdOrThrow(organisationId: string, id: string): Promise<ProductVariant> {
    const variant = await this.productVariantRepository.findById(organisationId, id);
    if (!variant) {
      throw new NotFoundException('Product variant not found');
    }
    return variant;
  }

  /** `VAR-000001`, `VAR-000002`, ... — globally unique (see `ProductVariant.code`
   *  schema comment), same collision-avoidance loop as
   *  `ProductFamilyService.generateUniqueCode`. */
  private async generateUniqueCode(): Promise<string> {
    let sequence = 1;
    let candidate = formatProductVariantCode(sequence);
    while (await this.productVariantRepository.existsByCode(candidate)) {
      sequence += 1;
      candidate = formatProductVariantCode(sequence);
    }
    return candidate;
  }
}

function formatProductVariantCode(sequence: number): string {
  return `${PRODUCT_VARIANT_CODE_PREFIX}-${String(sequence).padStart(PRODUCT_VARIANT_CODE_SEQUENCE_LENGTH, '0')}`;
}
