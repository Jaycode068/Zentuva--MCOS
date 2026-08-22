import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { BillOfMaterialStatus, ProductType } from '@prisma/client';
import { CreateBillOfMaterialInput, UpdateBillOfMaterialInput } from '@zentuva/validation';

import { ProductRepository } from '../catalogue/product/product.repository';
import {
  BillOfMaterialRepository,
  BillOfMaterialWithRelations,
  ListBillOfMaterialsParams,
} from './bill-of-material.repository';

const BOM_NUMBER_PREFIX = 'BOM';
const BOM_NUMBER_SEQUENCE_LENGTH = 6;

/** A component line may only reference these Product types — a recipe consumes inputs,
 *  never another finished product (Sprint 4.6 brief §4). Mirrors
 *  `PurchaseOrderService.PURCHASABLE_PRODUCT_TYPES` exactly, since these are the same
 *  "purchasable input" types by definition. */
const COMPONENT_PRODUCT_TYPES: ProductType[] = [
  ProductType.RAW_MATERIAL,
  ProductType.PACKAGING_MATERIAL,
  ProductType.CONSUMABLE,
];

interface BuiltItem {
  componentProductId: string;
  quantity: number;
  unitOfMeasure: string;
  notes?: string;
}

/**
 * Domain service for the `BillOfMaterial` aggregate (Sprint 4.6, docs/domains/
 * production.md). Owns the finished-product/component-type validation, the "only one
 * ACTIVE BOM per finished product" rule, the "DRAFT-only editing" rule, and the
 * `BOM-000001` number generator — mirrors `PurchaseOrderService`'s shape almost exactly.
 */
@Injectable()
export class BillOfMaterialService {
  constructor(
    private readonly billOfMaterialRepository: BillOfMaterialRepository,
    private readonly productRepository: ProductRepository,
  ) {}

  list(
    organisationId: string,
    params?: ListBillOfMaterialsParams,
  ): Promise<BillOfMaterialWithRelations[]> {
    return this.billOfMaterialRepository.findManyByOrganisation(organisationId, params);
  }

  async getById(organisationId: string, id: string): Promise<BillOfMaterialWithRelations> {
    const bom = await this.billOfMaterialRepository.findById(organisationId, id);
    if (!bom) {
      throw new NotFoundException('Bill of material not found');
    }
    return bom;
  }

  /** New bills of materials always start `DRAFT` (brief §5) — activation is a separate,
   *  explicit action via {@link activate}. */
  async create(
    organisationId: string,
    input: CreateBillOfMaterialInput,
    actorUserId: string,
  ): Promise<BillOfMaterialWithRelations> {
    await this.assertFinishedProduct(organisationId, input.productId);
    const items = await this.buildItems(organisationId, input.items);
    const bomNumber = await this.generateUniqueNumber();

    return this.billOfMaterialRepository.create({
      organisation: { connect: { id: organisationId } },
      bomNumber,
      product: { connect: { id: input.productId } },
      name: input.name,
      status: BillOfMaterialStatus.DRAFT,
      yieldQuantity: input.yieldQuantity,
      notes: input.notes,
      createdById: actorUserId,
      updatedById: actorUserId,
      items: { create: items },
    });
  }

  /** Only reachable while `status === DRAFT` (brief §5: "Do not allow an active BOM to
   *  be casually edited in a way that changes historical production meaning") — a BOM
   *  that has ever been active is superseded by creating a new one, never edited in
   *  place. */
  async update(
    organisationId: string,
    id: string,
    input: UpdateBillOfMaterialInput,
    actorUserId: string,
  ): Promise<BillOfMaterialWithRelations> {
    const existing = await this.getById(organisationId, id);
    if (existing.status !== BillOfMaterialStatus.DRAFT) {
      throw new BadRequestException('Only draft bills of material can be edited');
    }

    const items = input.items ? await this.buildItems(organisationId, input.items) : undefined;
    const updated = await this.billOfMaterialRepository.update(
      organisationId,
      id,
      {
        name: input.name,
        yieldQuantity: input.yieldQuantity,
        notes: input.notes,
        updatedById: actorUserId,
      },
      items,
    );
    if (!updated) {
      throw new NotFoundException('Bill of material not found');
    }
    return updated;
  }

  /** `POST /:id/activate` — requires `DRAFT`/`INACTIVE`; deactivates any prior `ACTIVE`
   *  BOM for the same finished product in the same atomic transaction (brief §5: "Only
   *  one BOM should be active for a finished product at a time"). */
  async activate(
    organisationId: string,
    id: string,
    actorUserId: string,
  ): Promise<BillOfMaterialWithRelations> {
    const existing = await this.getById(organisationId, id);
    if (existing.status === BillOfMaterialStatus.ACTIVE) {
      throw new BadRequestException('This bill of material is already active');
    }

    const result = await this.billOfMaterialRepository.activate(
      organisationId,
      id,
      existing.productId,
      actorUserId,
    );
    if (!result) {
      throw new NotFoundException('Bill of material not found');
    }
    return result.activated;
  }

  /** `POST /:id/deactivate` — requires `ACTIVE`. A product may legitimately end up with
   *  zero active BOMs afterward; that's a normal state (new Production Orders simply
   *  can't be created against this product until a BOM is reactivated), not an error. */
  async deactivate(
    organisationId: string,
    id: string,
    actorUserId: string,
  ): Promise<BillOfMaterialWithRelations> {
    const existing = await this.getById(organisationId, id);
    if (existing.status !== BillOfMaterialStatus.ACTIVE) {
      throw new BadRequestException('Only an active bill of material can be deactivated');
    }

    const updated = await this.billOfMaterialRepository.deactivate(organisationId, id, actorUserId);
    if (!updated) {
      throw new NotFoundException('Bill of material not found');
    }
    return this.getById(organisationId, id);
  }

  private async assertFinishedProduct(organisationId: string, productId: string): Promise<void> {
    const product = await this.productRepository.findById(organisationId, productId);
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    if (product.type !== ProductType.FINISHED_PRODUCT) {
      throw new BadRequestException(
        `"${product.name}" cannot have a bill of materials — only Finished Products can`,
      );
    }
  }

  /** Validates every component's product exists in this organisation and is a
   *  RAW_MATERIAL/PACKAGING_MATERIAL/CONSUMABLE — the second line of defense behind the
   *  frontend's type-filtered product picker, same convention as
   *  `PurchaseOrderService.buildItems`. */
  private async buildItems(
    organisationId: string,
    itemsInput: CreateBillOfMaterialInput['items'],
  ): Promise<BuiltItem[]> {
    const items: BuiltItem[] = [];
    for (const item of itemsInput) {
      const product = await this.productRepository.findById(
        organisationId,
        item.componentProductId,
      );
      if (!product) {
        throw new NotFoundException(`Product not found: ${item.componentProductId}`);
      }
      if (!COMPONENT_PRODUCT_TYPES.includes(product.type)) {
        throw new BadRequestException(
          `"${product.name}" cannot be a bill of material component — only Raw Material, ` +
            'Packaging Material, or Consumable products may be used',
        );
      }
      items.push({
        componentProductId: item.componentProductId,
        quantity: item.quantity,
        unitOfMeasure: item.unitOfMeasure,
        notes: item.notes,
      });
    }
    return items;
  }

  /** `BOM-000001`, `BOM-000002`, ... — globally unique (see `BillOfMaterial.bomNumber`
   *  schema comment), same collision-avoidance loop as `PurchaseOrderService`/
   *  `InventoryService`'s number generators. */
  private async generateUniqueNumber(): Promise<string> {
    let sequence = 1;
    let candidate = formatBomNumber(sequence);
    while (await this.billOfMaterialRepository.existsByNumber(candidate)) {
      sequence += 1;
      candidate = formatBomNumber(sequence);
    }
    return candidate;
  }
}

function formatBomNumber(sequence: number): string {
  return `${BOM_NUMBER_PREFIX}-${String(sequence).padStart(BOM_NUMBER_SEQUENCE_LENGTH, '0')}`;
}
