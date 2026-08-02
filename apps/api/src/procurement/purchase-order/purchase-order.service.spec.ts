import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  Product,
  ProductType,
  PurchaseOrderStatus,
  SupplierCategory,
  SupplierStatus,
} from '@prisma/client';

import { ProductRepository } from '../../catalogue/product/product.repository';
import { SupplierRepository } from '../../suppliers/supplier/supplier.repository';
import { PurchaseOrderRepository, PurchaseOrderWithRelations } from './purchase-order.repository';
import { PurchaseOrderService } from './purchase-order.service';

describe('PurchaseOrderService', () => {
  const supplier = {
    id: 'supplier-1',
    organisationId: 'org-1',
    supplierCode: 'SUP-000001',
    supplierName: 'Fresh Farms Ltd',
    displayName: null,
    contactPerson: null,
    email: null,
    phoneNumber: null,
    website: null,
    country: null,
    state: null,
    city: null,
    address: null,
    taxIdentificationNumber: null,
    supplierCategory: SupplierCategory.RAW_MATERIAL,
    status: SupplierStatus.ACTIVE,
    notes: null,
    createdById: null,
    updatedById: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  const rawMaterialProduct = {
    id: 'product-1',
    organisationId: 'org-1',
    code: 'PRD-000006',
    name: 'Plantain',
    displayName: null,
    slug: 'plantain',
    category: 'RAW_MATERIALS',
    type: ProductType.RAW_MATERIAL,
    shortDescription: null,
    longDescription: null,
    unit: 'Kilogram',
    imageUrl: null,
    imageKey: null,
    status: 'ACTIVE',
    createdById: null,
    updatedById: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  } as unknown as Product;

  const finishedProduct: Product = {
    ...rawMaterialProduct,
    id: 'product-2',
    type: ProductType.FINISHED_PRODUCT,
  };

  const purchaseOrder: PurchaseOrderWithRelations = {
    id: 'po-1',
    organisationId: 'org-1',
    purchaseOrderNumber: 'PO-000001',
    supplierId: 'supplier-1',
    orderDate: new Date('2026-08-01'),
    expectedDeliveryDate: null,
    status: PurchaseOrderStatus.DRAFT,
    remarks: null,
    subtotal: 700000,
    total: 700000,
    createdById: 'user-1',
    updatedById: 'user-1',
    approvedById: null,
    createdAt: new Date('2026-08-01'),
    updatedAt: new Date('2026-08-01'),
    items: [
      {
        id: 'item-1',
        purchaseOrderId: 'po-1',
        productId: 'product-1',
        quantity: 2000,
        unitPrice: 350,
        lineTotal: 700000,
        createdAt: new Date('2026-08-01'),
        updatedAt: new Date('2026-08-01'),
        product: { id: 'product-1', code: 'PRD-000006', name: 'Plantain', unit: 'Kilogram' },
      },
    ],
    supplier: { id: 'supplier-1', supplierCode: 'SUP-000001', supplierName: 'Fresh Farms Ltd' },
  };

  function makeService() {
    const purchaseOrderRepository = {
      create: jest.fn(),
      findById: jest.fn(),
      findManyByOrganisation: jest.fn(),
      existsByNumber: jest.fn().mockResolvedValue(false),
      update: jest.fn(),
    } as unknown as jest.Mocked<PurchaseOrderRepository>;
    const productRepository = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<ProductRepository>;
    const supplierRepository = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<SupplierRepository>;

    const service = new PurchaseOrderService(
      purchaseOrderRepository,
      productRepository,
      supplierRepository,
    );
    return { service, purchaseOrderRepository, productRepository, supplierRepository };
  }

  describe('create', () => {
    it('computes line totals, subtotal, and total, and generates a PO number', async () => {
      const { service, purchaseOrderRepository, productRepository, supplierRepository } =
        makeService();
      supplierRepository.findById.mockResolvedValue(supplier);
      productRepository.findById.mockResolvedValue(rawMaterialProduct);
      purchaseOrderRepository.create.mockResolvedValue(purchaseOrder);

      await service.create(
        'org-1',
        {
          supplierId: 'supplier-1',
          orderDate: new Date('2026-08-01'),
          items: [{ productId: 'product-1', quantity: 2000, unitPrice: 350 }],
        },
        'user-1',
      );

      expect(purchaseOrderRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          purchaseOrderNumber: 'PO-000001',
          subtotal: 700000,
          total: 700000,
          status: PurchaseOrderStatus.DRAFT,
          items: {
            create: [{ productId: 'product-1', quantity: 2000, unitPrice: 350, lineTotal: 700000 }],
          },
        }),
      );
    });

    it('increments the PO number sequence on collision', async () => {
      const { service, purchaseOrderRepository, productRepository, supplierRepository } =
        makeService();
      supplierRepository.findById.mockResolvedValue(supplier);
      productRepository.findById.mockResolvedValue(rawMaterialProduct);
      purchaseOrderRepository.existsByNumber
        .mockResolvedValueOnce(true) // PO-000001 taken
        .mockResolvedValueOnce(false); // PO-000002 free
      purchaseOrderRepository.create.mockResolvedValue(purchaseOrder);

      await service.create(
        'org-1',
        {
          supplierId: 'supplier-1',
          orderDate: new Date('2026-08-01'),
          items: [{ productId: 'product-1', quantity: 2000, unitPrice: 350 }],
        },
        'user-1',
      );

      expect(purchaseOrderRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ purchaseOrderNumber: 'PO-000002' }),
      );
    });

    it('throws NotFoundException when the supplier does not exist in this organisation', async () => {
      const { service, supplierRepository } = makeService();
      supplierRepository.findById.mockResolvedValue(null);

      await expect(
        service.create(
          'org-1',
          {
            supplierId: 'missing',
            orderDate: new Date('2026-08-01'),
            items: [{ productId: 'product-1', quantity: 1, unitPrice: 1 }],
          },
          'user-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when an item product does not exist in this organisation', async () => {
      const { service, supplierRepository, productRepository } = makeService();
      supplierRepository.findById.mockResolvedValue(supplier);
      productRepository.findById.mockResolvedValue(null);

      await expect(
        service.create(
          'org-1',
          {
            supplierId: 'supplier-1',
            orderDate: new Date('2026-08-01'),
            items: [{ productId: 'missing', quantity: 1, unitPrice: 1 }],
          },
          'user-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects a Finished Product item', async () => {
      const { service, supplierRepository, productRepository } = makeService();
      supplierRepository.findById.mockResolvedValue(supplier);
      productRepository.findById.mockResolvedValue(finishedProduct);

      await expect(
        service.create(
          'org-1',
          {
            supplierId: 'supplier-1',
            orderDate: new Date('2026-08-01'),
            items: [{ productId: 'product-2', quantity: 1, unitPrice: 1 }],
          },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('update', () => {
    it('throws NotFoundException when the purchase order does not exist in this organisation', async () => {
      const { service, purchaseOrderRepository } = makeService();
      purchaseOrderRepository.findById.mockResolvedValue(null);

      await expect(service.update('org-1', 'missing', { remarks: 'x' }, 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rejects editing a cancelled purchase order', async () => {
      const { service, purchaseOrderRepository } = makeService();
      purchaseOrderRepository.findById.mockResolvedValue({
        ...purchaseOrder,
        status: PurchaseOrderStatus.CANCELLED,
      });

      await expect(service.update('org-1', 'po-1', { remarks: 'x' }, 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('recalculates totals when items are replaced', async () => {
      const { service, purchaseOrderRepository, productRepository } = makeService();
      purchaseOrderRepository.findById.mockResolvedValue(purchaseOrder);
      productRepository.findById.mockResolvedValue(rawMaterialProduct);
      purchaseOrderRepository.update.mockResolvedValue(purchaseOrder);

      await service.update(
        'org-1',
        'po-1',
        { items: [{ productId: 'product-1', quantity: 1000, unitPrice: 350 }] },
        'user-1',
      );

      expect(purchaseOrderRepository.update).toHaveBeenCalledWith(
        'org-1',
        'po-1',
        expect.objectContaining({ subtotal: 350000, total: 350000 }),
        [{ productId: 'product-1', quantity: 1000, unitPrice: 350, lineTotal: 350000 }],
      );
    });

    it('passes a partial header update through without touching items', async () => {
      const { service, purchaseOrderRepository } = makeService();
      purchaseOrderRepository.findById.mockResolvedValue(purchaseOrder);
      purchaseOrderRepository.update.mockResolvedValue({ ...purchaseOrder, remarks: 'Urgent' });

      await service.update('org-1', 'po-1', { remarks: 'Urgent' }, 'user-2');

      expect(purchaseOrderRepository.update).toHaveBeenCalledWith(
        'org-1',
        'po-1',
        expect.objectContaining({ remarks: 'Urgent', updatedById: 'user-2' }),
        undefined,
      );
    });
  });

  describe('cancel', () => {
    it('transitions DRAFT to CANCELLED', async () => {
      const { service, purchaseOrderRepository } = makeService();
      purchaseOrderRepository.findById.mockResolvedValue(purchaseOrder);
      purchaseOrderRepository.update.mockResolvedValue({
        ...purchaseOrder,
        status: PurchaseOrderStatus.CANCELLED,
      });

      await service.cancel('org-1', 'po-1', 'user-2');

      expect(purchaseOrderRepository.update).toHaveBeenCalledWith('org-1', 'po-1', {
        status: PurchaseOrderStatus.CANCELLED,
        updatedById: 'user-2',
      });
    });

    it('rejects cancelling an already-cancelled purchase order', async () => {
      const { service, purchaseOrderRepository } = makeService();
      purchaseOrderRepository.findById.mockResolvedValue({
        ...purchaseOrder,
        status: PurchaseOrderStatus.CANCELLED,
      });

      await expect(service.cancel('org-1', 'po-1', 'user-2')).rejects.toThrow(BadRequestException);
    });
  });
});
