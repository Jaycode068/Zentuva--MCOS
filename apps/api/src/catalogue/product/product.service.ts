import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Product, ProductStatus } from '@prisma/client';
import { CreateProductInput, UpdateProductInput } from '@zentuva/validation';

import { FILE_STORAGE, FileStorage } from '../../identity/organisation/ports/file-storage.port';
import { ListProductsParams, ProductRepository } from './product.repository';

const PRODUCT_CODE_PREFIX = 'PRD';
const PRODUCT_CODE_SEQUENCE_LENGTH = 6;

/**
 * Domain service for the Product aggregate (Sprint 4.1, docs/domains/catalogue.md).
 * Mirrors `UserService`/`OrganisationService`'s shape: repository access + business rules
 * (code/slug generation, status-transition validation, image upload via the shared
 * `FileStorage` port) live here, not in `ProductController`.
 */
@Injectable()
export class ProductService {
  constructor(
    private readonly productRepository: ProductRepository,
    @Inject(FILE_STORAGE) private readonly fileStorage: FileStorage,
  ) {}

  getById(organisationId: string, id: string): Promise<Product | null> {
    return this.productRepository.findById(organisationId, id);
  }

  list(organisationId: string, params?: ListProductsParams): Promise<Product[]> {
    return this.productRepository.findManyByOrganisation(organisationId, params);
  }

  /** New products always start `DRAFT` (brief: "Status defaults to Draft") — reaching
   *  `ACTIVE`/`ARCHIVED` only happens through {@link activate}/{@link archive}. */
  async create(
    organisationId: string,
    input: CreateProductInput,
    actorUserId: string,
  ): Promise<Product> {
    const code = await this.generateUniqueCode();
    const slug = await this.generateUniqueSlug(organisationId, input.name);

    return this.productRepository.create({
      organisation: { connect: { id: organisationId } },
      code,
      name: input.name,
      displayName: input.displayName,
      slug,
      category: input.category,
      type: input.type,
      unit: input.unit,
      shortDescription: input.shortDescription,
      longDescription: input.longDescription,
      status: ProductStatus.DRAFT,
      createdById: actorUserId,
      updatedById: actorUserId,
    });
  }

  /** Partial update — `code` and `status` are never accepted here (brief: "Product Code
   *  immutable"; status transitions go through {@link activate}/{@link archive} only). */
  async update(
    organisationId: string,
    id: string,
    input: UpdateProductInput,
    actorUserId: string,
  ): Promise<Product> {
    await this.getByIdOrThrow(organisationId, id);

    const updated = await this.productRepository.update(organisationId, id, {
      name: input.name,
      displayName: input.displayName,
      category: input.category,
      type: input.type,
      unit: input.unit,
      shortDescription: input.shortDescription,
      longDescription: input.longDescription,
      updatedById: actorUserId,
    });
    if (!updated) {
      throw new NotFoundException('Product not found');
    }
    return updated;
  }

  /** `POST /:id/activate` — valid from `DRAFT` or `ARCHIVED` only (brief: "Enforce...
   *  Valid status transitions"). */
  async activate(organisationId: string, id: string, actorUserId: string): Promise<Product> {
    const product = await this.getByIdOrThrow(organisationId, id);
    if (product.status === ProductStatus.ACTIVE) {
      throw new BadRequestException('Product is already active');
    }
    return this.setStatus(organisationId, id, ProductStatus.ACTIVE, actorUserId);
  }

  /** `POST /:id/archive` — valid from `DRAFT` or `ACTIVE` only. Products are never
   *  physically deleted (brief); this is the terminal "removed from active use" state. */
  async archive(organisationId: string, id: string, actorUserId: string): Promise<Product> {
    const product = await this.getByIdOrThrow(organisationId, id);
    if (product.status === ProductStatus.ARCHIVED) {
      throw new BadRequestException('Product is already archived');
    }
    return this.setStatus(organisationId, id, ProductStatus.ARCHIVED, actorUserId);
  }

  /**
   * Product image upload (`POST /:id/image`) — same pattern as
   * `OrganisationService.setLogo` (Sprint 3.4) and `UserService.setAvatar` (Sprint 3.5):
   * upload via the injected {@link FileStorage} port, store the resulting URL, and
   * best-effort delete the previous file (if any) so replacing an image doesn't leak
   * orphaned files.
   */
  async setImage(
    organisationId: string,
    id: string,
    file: { mimeType: string; buffer: Buffer },
    actorUserId: string,
  ): Promise<Product> {
    const product = await this.getByIdOrThrow(organisationId, id);
    const previousKey = product.imageKey;

    const uploaded = await this.fileStorage.upload({
      organisationId,
      folder: 'products',
      mimeType: file.mimeType,
      buffer: file.buffer,
    });

    const updated = await this.productRepository.update(organisationId, id, {
      imageUrl: uploaded.url,
      imageKey: uploaded.key,
      updatedById: actorUserId,
    });
    if (!updated) {
      throw new NotFoundException('Product not found');
    }

    if (previousKey) {
      await this.fileStorage.delete(previousKey).catch(() => undefined);
    }
    return updated;
  }

  /** `DELETE /:id/image`. */
  async removeImage(organisationId: string, id: string, actorUserId: string): Promise<Product> {
    const product = await this.getByIdOrThrow(organisationId, id);
    const key = product.imageKey;

    const updated = await this.productRepository.update(organisationId, id, {
      imageUrl: null,
      imageKey: null,
      updatedById: actorUserId,
    });
    if (!updated) {
      throw new NotFoundException('Product not found');
    }

    if (key) {
      await this.fileStorage.delete(key).catch(() => undefined);
    }
    return updated;
  }

  private async setStatus(
    organisationId: string,
    id: string,
    status: ProductStatus,
    actorUserId: string,
  ): Promise<Product> {
    const updated = await this.productRepository.update(organisationId, id, {
      status,
      updatedById: actorUserId,
    });
    if (!updated) {
      throw new NotFoundException('Product not found');
    }
    return updated;
  }

  private async getByIdOrThrow(organisationId: string, id: string): Promise<Product> {
    const product = await this.productRepository.findById(organisationId, id);
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    return product;
  }

  /** `PRD-000001`, `PRD-000002`, ... — globally unique (see `Product.code` schema
   *  comment), same collision-avoidance loop as
   *  `OrganisationService.generateUniqueOrganisationCode` (Sprint 3.2). */
  private async generateUniqueCode(): Promise<string> {
    let sequence = 1;
    let candidate = formatProductCode(sequence);
    while (await this.productRepository.existsByCode(candidate)) {
      sequence += 1;
      candidate = formatProductCode(sequence);
    }
    return candidate;
  }

  private async generateUniqueSlug(organisationId: string, name: string): Promise<string> {
    const base = slugify(name);
    let candidate = base;
    let suffix = 1;
    while (await this.productRepository.existsBySlug(organisationId, candidate)) {
      suffix += 1;
      candidate = `${base}-${suffix}`;
    }
    return candidate;
  }
}

function formatProductCode(sequence: number): string {
  return `${PRODUCT_CODE_PREFIX}-${String(sequence).padStart(PRODUCT_CODE_SEQUENCE_LENGTH, '0')}`;
}

/** Same slugify implementation as `OrganisationService` (Sprint 3.2) — kept local rather
 *  than shared since it's a one-line pure function and the two domains shouldn't import
 *  each other's internals (ADR-002). */
function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'product';
}
