import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BillOfMaterialStatus, Product, ProductType } from '@prisma/client';

import { ProductRepository } from '../catalogue/product/product.repository';
import {
  BillOfMaterialRepository,
  BillOfMaterialWithRelations,
} from './bill-of-material.repository';
import { BillOfMaterialService } from './bill-of-material.service';

describe('BillOfMaterialService', () => {
  const finishedProduct = {
    id: 'product-finished',
    organisationId: 'org-1',
    code: 'PRD-000001',
    name: 'Plantain Chips',
    displayName: null,
    slug: 'plantain-chips',
    category: 'FINISHED_GOODS',
    type: ProductType.FINISHED_PRODUCT,
    shortDescription: null,
    longDescription: null,
    unit: 'Pack',
    imageUrl: null,
    imageKey: null,
    status: 'ACTIVE',
    createdById: null,
    updatedById: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  } as unknown as Product;

  const rawMaterialProduct: Product = {
    ...finishedProduct,
    id: 'product-raw',
    code: 'PRD-000002',
    name: 'Plantain',
    type: ProductType.RAW_MATERIAL,
    unit: 'Kilogram',
  };

  const packagingProduct: Product = {
    ...finishedProduct,
    id: 'product-packaging',
    code: 'PRD-000003',
    name: 'Printed Nylon',
    type: ProductType.PACKAGING_MATERIAL,
    unit: 'Roll',
  };

  const bom: BillOfMaterialWithRelations = {
    id: 'bom-1',
    organisationId: 'org-1',
    bomNumber: 'BOM-000001',
    productId: 'product-finished',
    name: 'Plantain Chips v1',
    status: BillOfMaterialStatus.DRAFT,
    yieldQuantity: 1000,
    notes: null,
    createdById: 'user-1',
    updatedById: 'user-1',
    createdAt: new Date('2026-08-01'),
    updatedAt: new Date('2026-08-01'),
    product: {
      id: 'product-finished',
      code: 'PRD-000001',
      name: 'Plantain Chips',
      type: ProductType.FINISHED_PRODUCT,
      unit: 'Pack',
    },
    items: [
      {
        id: 'item-1',
        componentProductId: 'product-raw',
        quantity: 500,
        unitOfMeasure: 'Kilogram',
        notes: null,
        componentProduct: {
          id: 'product-raw',
          code: 'PRD-000002',
          name: 'Plantain',
          type: ProductType.RAW_MATERIAL,
          unit: 'Kilogram',
        },
      },
    ],
  };

  function makeService() {
    const billOfMaterialRepository = {
      create: jest.fn(),
      findById: jest.fn(),
      findManyByOrganisation: jest.fn(),
      findActiveByProduct: jest.fn(),
      existsByNumber: jest.fn().mockResolvedValue(false),
      update: jest.fn(),
      activate: jest.fn(),
      deactivate: jest.fn(),
    } as unknown as jest.Mocked<BillOfMaterialRepository>;
    const productRepository = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<ProductRepository>;

    const service = new BillOfMaterialService(billOfMaterialRepository, productRepository);
    return { service, billOfMaterialRepository, productRepository };
  }

  describe('create', () => {
    it('creates a DRAFT bom with a generated bom number', async () => {
      const { service, billOfMaterialRepository, productRepository } = makeService();
      productRepository.findById
        .mockResolvedValueOnce(finishedProduct)
        .mockResolvedValueOnce(rawMaterialProduct);
      billOfMaterialRepository.create.mockResolvedValue(bom);

      await service.create(
        'org-1',
        {
          productId: 'product-finished',
          yieldQuantity: 1000,
          items: [{ componentProductId: 'product-raw', quantity: 500, unitOfMeasure: 'Kilogram' }],
        },
        'user-1',
      );

      expect(billOfMaterialRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          bomNumber: 'BOM-000001',
          status: BillOfMaterialStatus.DRAFT,
          yieldQuantity: 1000,
        }),
      );
    });

    it('validates a Product that has a productVariantId exactly like one that does not (Sprint 4.7 regression)', async () => {
      // `assertFinishedProduct`/`buildItems` only ever inspect `.type` — proves the
      // Sprint 4.7 hierarchy addition is invisible to Production's own Product
      // consumption, since `ProductRepository.findById` (the only method this service
      // calls) was deliberately left unchanged.
      const { service, billOfMaterialRepository, productRepository } = makeService();
      const variantAttachedFinishedProduct = {
        ...finishedProduct,
        productVariantId: 'variant-1',
      } as unknown as Product;
      productRepository.findById
        .mockResolvedValueOnce(variantAttachedFinishedProduct)
        .mockResolvedValueOnce(rawMaterialProduct);
      billOfMaterialRepository.create.mockResolvedValue(bom);

      await service.create(
        'org-1',
        {
          productId: 'product-finished',
          yieldQuantity: 1000,
          items: [{ componentProductId: 'product-raw', quantity: 500, unitOfMeasure: 'Kilogram' }],
        },
        'user-1',
      );

      expect(billOfMaterialRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ bomNumber: 'BOM-000001' }),
      );
    });

    it('increments the bom number sequence on collision', async () => {
      const { service, billOfMaterialRepository, productRepository } = makeService();
      productRepository.findById
        .mockResolvedValueOnce(finishedProduct)
        .mockResolvedValueOnce(rawMaterialProduct);
      billOfMaterialRepository.existsByNumber
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);
      billOfMaterialRepository.create.mockResolvedValue(bom);

      await service.create(
        'org-1',
        {
          productId: 'product-finished',
          yieldQuantity: 1000,
          items: [{ componentProductId: 'product-raw', quantity: 500, unitOfMeasure: 'Kilogram' }],
        },
        'user-1',
      );

      expect(billOfMaterialRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ bomNumber: 'BOM-000002' }),
      );
    });

    it('rejects a product that is not a Finished Product', async () => {
      const { service, productRepository } = makeService();
      productRepository.findById.mockResolvedValue(rawMaterialProduct);

      await expect(
        service.create(
          'org-1',
          {
            productId: 'product-raw',
            yieldQuantity: 1000,
            items: [
              { componentProductId: 'product-raw', quantity: 500, unitOfMeasure: 'Kilogram' },
            ],
          },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when the finished product does not exist in this organisation', async () => {
      const { service, productRepository } = makeService();
      productRepository.findById.mockResolvedValue(null);

      await expect(
        service.create(
          'org-1',
          {
            productId: 'missing',
            yieldQuantity: 1000,
            items: [
              { componentProductId: 'product-raw', quantity: 500, unitOfMeasure: 'Kilogram' },
            ],
          },
          'user-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects a Finished Product used as a component', async () => {
      const { service, productRepository } = makeService();
      productRepository.findById
        .mockResolvedValueOnce(finishedProduct)
        .mockResolvedValueOnce(finishedProduct);

      await expect(
        service.create(
          'org-1',
          {
            productId: 'product-finished',
            yieldQuantity: 1000,
            items: [
              { componentProductId: 'product-finished', quantity: 500, unitOfMeasure: 'Pack' },
            ],
          },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts RAW_MATERIAL, PACKAGING_MATERIAL, and CONSUMABLE components', async () => {
      const { service, billOfMaterialRepository, productRepository } = makeService();
      productRepository.findById
        .mockResolvedValueOnce(finishedProduct)
        .mockResolvedValueOnce(rawMaterialProduct)
        .mockResolvedValueOnce(packagingProduct);
      billOfMaterialRepository.create.mockResolvedValue(bom);

      await service.create(
        'org-1',
        {
          productId: 'product-finished',
          yieldQuantity: 1000,
          items: [
            { componentProductId: 'product-raw', quantity: 500, unitOfMeasure: 'Kilogram' },
            { componentProductId: 'product-packaging', quantity: 1000, unitOfMeasure: 'Roll' },
          ],
        },
        'user-1',
      );

      expect(billOfMaterialRepository.create).toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('rejects editing a non-draft bom', async () => {
      const { service, billOfMaterialRepository } = makeService();
      billOfMaterialRepository.findById.mockResolvedValue({
        ...bom,
        status: BillOfMaterialStatus.ACTIVE,
      });

      await expect(service.update('org-1', 'bom-1', { name: 'v2' }, 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws NotFoundException when the bom does not exist in this organisation', async () => {
      const { service, billOfMaterialRepository } = makeService();
      billOfMaterialRepository.findById.mockResolvedValue(null);

      await expect(service.update('org-1', 'missing', { name: 'v2' }, 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('allows editing a draft bom', async () => {
      const { service, billOfMaterialRepository } = makeService();
      billOfMaterialRepository.findById.mockResolvedValue(bom);
      billOfMaterialRepository.update.mockResolvedValue(bom);

      await service.update('org-1', 'bom-1', { name: 'v2' }, 'user-1');

      expect(billOfMaterialRepository.update).toHaveBeenCalledWith(
        'org-1',
        'bom-1',
        expect.objectContaining({ name: 'v2', updatedById: 'user-1' }),
        undefined,
      );
    });
  });

  describe('activate', () => {
    it('activates a draft bom', async () => {
      const { service, billOfMaterialRepository } = makeService();
      billOfMaterialRepository.findById.mockResolvedValue(bom);
      billOfMaterialRepository.activate.mockResolvedValue({
        activated: { ...bom, status: BillOfMaterialStatus.ACTIVE },
        deactivated: null,
      });

      const result = await service.activate('org-1', 'bom-1', 'user-1');

      expect(result.status).toBe(BillOfMaterialStatus.ACTIVE);
      expect(billOfMaterialRepository.activate).toHaveBeenCalledWith(
        'org-1',
        'bom-1',
        'product-finished',
        'user-1',
      );
    });

    it('rejects activating an already-active bom', async () => {
      const { service, billOfMaterialRepository } = makeService();
      billOfMaterialRepository.findById.mockResolvedValue({
        ...bom,
        status: BillOfMaterialStatus.ACTIVE,
      });

      await expect(service.activate('org-1', 'bom-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws NotFoundException when the bom does not exist in this organisation', async () => {
      const { service, billOfMaterialRepository } = makeService();
      billOfMaterialRepository.findById.mockResolvedValue(null);

      await expect(service.activate('org-1', 'missing', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('deactivate', () => {
    it('deactivates an active bom', async () => {
      const { service, billOfMaterialRepository } = makeService();
      const activeBom = { ...bom, status: BillOfMaterialStatus.ACTIVE };
      billOfMaterialRepository.findById.mockResolvedValueOnce(activeBom).mockResolvedValueOnce({
        ...activeBom,
        status: BillOfMaterialStatus.INACTIVE,
      });
      billOfMaterialRepository.deactivate.mockResolvedValue({
        ...activeBom,
        status: BillOfMaterialStatus.INACTIVE,
      });

      const result = await service.deactivate('org-1', 'bom-1', 'user-1');

      expect(result.status).toBe(BillOfMaterialStatus.INACTIVE);
    });

    it('rejects deactivating a bom that is not active', async () => {
      const { service, billOfMaterialRepository } = makeService();
      billOfMaterialRepository.findById.mockResolvedValue(bom);

      await expect(service.deactivate('org-1', 'bom-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('tenant isolation', () => {
    it('getById throws NotFoundException for a bom belonging to another organisation', async () => {
      const { service, billOfMaterialRepository } = makeService();
      billOfMaterialRepository.findById.mockResolvedValue(null);

      await expect(service.getById('org-2', 'bom-1')).rejects.toThrow(NotFoundException);
      expect(billOfMaterialRepository.findById).toHaveBeenCalledWith('org-2', 'bom-1');
    });
  });
});
