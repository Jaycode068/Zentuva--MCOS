import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DiscrepancyStatus, Product, ProductType, PurchaseOrderStatus } from '@prisma/client';

import { ProductRepository } from '../catalogue/product/product.repository';
import {
  PurchaseOrderRepository,
  PurchaseOrderWithRelations,
} from '../procurement/purchase-order/purchase-order.repository';
import { GoodsReceiptConflictError, GoodsReceiptRepository } from './goods-receipt.repository';
import { InventoryService } from './inventory.service';
import { InventoryLocationRepository } from './inventory-location.repository';
import {
  InventoryStockRepository,
  OpeningStockAlreadyRecordedError,
} from './inventory-stock.repository';
import { InventoryTransactionRepository } from './inventory-transaction.repository';
import {
  InsufficientStockError,
  InventoryTransferRepository,
  OwnershipMismatchError,
  TransferNotReversibleError,
} from './inventory-transfer.repository';

const defaultLocation = {
  id: 'loc-1',
  organisationId: 'org-1',
  name: 'Main Warehouse',
  status: 'ACTIVE' as const,
  isDefault: true,
  locationType: 'WAREHOUSE' as const,
  outletId: null,
  createdById: 'user-2',
  updatedById: 'user-2',
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

describe('InventoryService', () => {
  const product: Product = {
    id: 'product-1',
    organisationId: 'org-1',
    code: 'PRD-000009',
    name: 'Salt',
    displayName: null,
    slug: 'salt',
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

  function makePurchaseOrder(
    status: PurchaseOrderStatus,
    quantity = 500,
  ): PurchaseOrderWithRelations {
    return {
      id: 'po-1',
      organisationId: 'org-1',
      purchaseOrderNumber: 'PO-000004',
      supplierId: 'supplier-1',
      orderDate: new Date('2026-08-01'),
      expectedDeliveryDate: null,
      status,
      remarks: null,
      subtotal: quantity * 200,
      total: quantity * 200,
      createdById: 'user-1',
      updatedById: 'user-1',
      approvedById: null,
      createdAt: new Date('2026-08-01'),
      updatedAt: new Date('2026-08-01'),
      items: [
        {
          id: 'poi-1',
          purchaseOrderId: 'po-1',
          productId: 'product-1',
          quantity,
          unitPrice: 200,
          lineTotal: quantity * 200,
          createdAt: new Date('2026-08-01'),
          updatedAt: new Date('2026-08-01'),
          product: { id: 'product-1', code: 'PRD-000009', name: 'Salt', unit: 'Kilogram' },
        },
      ],
      supplier: { id: 'supplier-1', supplierCode: 'SUP-000004', supplierName: 'Salt Masters Ltd' },
    };
  }

  const baseGoodsReceipt = {
    id: 'gr-1',
    organisationId: 'org-1',
    goodsReceiptNumber: 'GRN-000001',
    purchaseOrderId: 'po-1',
    supplierId: 'supplier-1',
    receivedDate: new Date('2026-08-05'),
    receivedById: 'user-2',
    remarks: null,
    discrepancyStatus: DiscrepancyStatus.NONE,
    discrepancyNotes: null,
    discrepancyResolutionAction: null,
    replacesGoodsReceiptId: null,
    idempotencyKey: null,
    locationId: 'loc-1',
    location: { id: 'loc-1', name: 'Main Warehouse' },
    createdAt: new Date('2026-08-05'),
    updatedAt: new Date('2026-08-05'),
    items: [
      {
        id: 'gri-1',
        goodsReceiptId: 'gr-1',
        purchaseOrderItemId: 'poi-1',
        productId: 'product-1',
        deliveredQuantity: 500,
        rejectedQuantity: 0,
        acceptedQuantity: 500,
        payableQuantity: 500,
        returnedQuantity: 0,
        returnedExcessQuantity: 0,
        replacedQuantity: 0,
        replacesRejectedItemId: null,
        invoicedQuantity: 0,
        rejectionReason: null,
        rejectionNotes: null,
        createdAt: new Date('2026-08-05'),
        product: { id: 'product-1', code: 'PRD-000009', name: 'Salt', unit: 'Kilogram' },
        purchaseOrderItem: { unitPrice: 1000 },
      },
    ],
    supplier: { id: 'supplier-1', supplierCode: 'SUP-000004', supplierName: 'Salt Masters Ltd' },
    purchaseOrder: { id: 'po-1', purchaseOrderNumber: 'PO-000004' },
  };

  function makeService() {
    const goodsReceiptRepository = {
      receive: jest.fn(),
      findById: jest.fn(),
      findManyByOrganisation: jest.fn(),
      existsByNumber: jest.fn().mockResolvedValue(false),
      getReceivingTotals: jest.fn().mockResolvedValue(new Map()),
      updateDiscrepancyStatus: jest.fn(),
    } as unknown as jest.Mocked<GoodsReceiptRepository>;
    const inventoryStockRepository = {
      findManyByOrganisation: jest.fn(),
      findManyByProduct: jest.fn().mockResolvedValue([]),
      findByProductAndLocation: jest.fn(),
      adjustStock: jest.fn(),
      recordOpeningStock: jest.fn(),
    } as unknown as jest.Mocked<InventoryStockRepository>;
    const inventoryTransactionRepository = {
      findManyByOrganisation: jest.fn(),
      getLastMovementForProduct: jest.fn().mockResolvedValue(null),
      getLastMovementByProduct: jest.fn().mockResolvedValue(new Map()),
    } as unknown as jest.Mocked<InventoryTransactionRepository>;
    const inventoryLocationRepository = {
      findById: jest.fn(),
      findManyByOrganisation: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
      getOrCreateDefault: jest.fn().mockResolvedValue(defaultLocation),
      outletExists: jest.fn().mockResolvedValue(true),
      findByOutletId: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<InventoryLocationRepository>;
    const purchaseOrderRepository = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<PurchaseOrderRepository>;
    const productRepository = {
      findById: jest.fn().mockResolvedValue(product),
    } as unknown as jest.Mocked<ProductRepository>;
    const inventoryTransferRepository = {
      create: jest.fn(),
      reverse: jest.fn(),
      findById: jest.fn(),
      findManyByOrganisation: jest.fn().mockResolvedValue([]),
      existsByNumber: jest.fn().mockResolvedValue(false),
    } as unknown as jest.Mocked<InventoryTransferRepository>;

    const service = new InventoryService(
      goodsReceiptRepository,
      inventoryStockRepository,
      inventoryTransactionRepository,
      inventoryLocationRepository,
      purchaseOrderRepository,
      productRepository,
      inventoryTransferRepository,
    );
    return {
      service,
      goodsReceiptRepository,
      inventoryStockRepository,
      inventoryTransactionRepository,
      inventoryLocationRepository,
      purchaseOrderRepository,
      productRepository,
      inventoryTransferRepository,
    };
  }

  describe('receiveGoods', () => {
    it('Scenario A — exact delivery: accepted equals delivered, no discrepancy', async () => {
      const { service, purchaseOrderRepository, goodsReceiptRepository } = makeService();
      purchaseOrderRepository.findById.mockResolvedValue(
        makePurchaseOrder(PurchaseOrderStatus.PENDING, 500),
      );
      goodsReceiptRepository.receive.mockResolvedValue({
        goodsReceipt: baseGoodsReceipt,
        purchaseOrderStatus: PurchaseOrderStatus.RECEIVED,
        journalEntry: null,
        wasCreated: true,
      });

      const result = await service.receiveGoods(
        'org-1',
        {
          purchaseOrderId: 'po-1',
          receivedDate: new Date('2026-08-05'),
          items: [{ purchaseOrderItemId: 'poi-1', deliveredQuantity: 500, rejectedQuantity: 0 }],
        },
        'user-2',
      );

      expect(goodsReceiptRepository.receive).toHaveBeenCalledWith(
        expect.objectContaining({
          discrepancyStatus: DiscrepancyStatus.NONE,
          items: [
            expect.objectContaining({
              purchaseOrderItemId: 'poi-1',
              productId: 'product-1',
              deliveredQuantity: 500,
              rejectedQuantity: 0,
              acceptedQuantity: 500,
            }),
          ],
        }),
      );
      expect(result.hasDiscrepancy).toBe(false);
      expect(result.isFirstReceipt).toBe(true);
      expect(result.purchaseOrderStatus).toBe(PurchaseOrderStatus.RECEIVED);
    });

    it('Scenario C — defective goods: accepted is delivered minus rejected, discrepancy recorded', async () => {
      const { service, purchaseOrderRepository, goodsReceiptRepository } = makeService();
      purchaseOrderRepository.findById.mockResolvedValue(
        makePurchaseOrder(PurchaseOrderStatus.PENDING, 500),
      );
      goodsReceiptRepository.receive.mockResolvedValue({
        goodsReceipt: baseGoodsReceipt,
        purchaseOrderStatus: PurchaseOrderStatus.RECEIVED,
        journalEntry: null,
        wasCreated: true,
      });

      const result = await service.receiveGoods(
        'org-1',
        {
          purchaseOrderId: 'po-1',
          receivedDate: new Date('2026-08-05'),
          items: [
            {
              purchaseOrderItemId: 'poi-1',
              deliveredQuantity: 500,
              rejectedQuantity: 20,
              rejectionReason: 'DEFECTIVE',
              rejectionNotes: 'Torn packaging',
            },
          ],
        },
        'user-2',
      );

      expect(goodsReceiptRepository.receive).toHaveBeenCalledWith(
        expect.objectContaining({
          discrepancyStatus: DiscrepancyStatus.PENDING_SUPPLIER,
          items: [
            expect.objectContaining({
              deliveredQuantity: 500,
              rejectedQuantity: 20,
              acceptedQuantity: 480,
              rejectionReason: 'DEFECTIVE',
            }),
          ],
        }),
      );
      expect(result.hasDiscrepancy).toBe(true);
    });

    it('Scenario E — excess delivery is never capped at the ordered quantity', async () => {
      const { service, purchaseOrderRepository, goodsReceiptRepository } = makeService();
      purchaseOrderRepository.findById.mockResolvedValue(
        makePurchaseOrder(PurchaseOrderStatus.PENDING, 1000),
      );
      goodsReceiptRepository.receive.mockResolvedValue({
        goodsReceipt: baseGoodsReceipt,
        purchaseOrderStatus: PurchaseOrderStatus.RECEIVED,
        journalEntry: null,
        wasCreated: true,
      });

      await service.receiveGoods(
        'org-1',
        {
          purchaseOrderId: 'po-1',
          receivedDate: new Date('2026-08-05'),
          items: [{ purchaseOrderItemId: 'poi-1', deliveredQuantity: 1100, rejectedQuantity: 50 }],
        },
        'user-2',
      );

      expect(goodsReceiptRepository.receive).toHaveBeenCalledWith(
        expect.objectContaining({
          items: [expect.objectContaining({ deliveredQuantity: 1100, acceptedQuantity: 1050 })],
        }),
      );
    });

    it('allows receiving a PARTIALLY_RECEIVED purchase order (a second/replacement receipt)', async () => {
      const { service, purchaseOrderRepository, goodsReceiptRepository } = makeService();
      purchaseOrderRepository.findById.mockResolvedValue(
        makePurchaseOrder(PurchaseOrderStatus.PARTIALLY_RECEIVED, 500),
      );
      goodsReceiptRepository.getReceivingTotals.mockResolvedValue(
        new Map([
          [
            'poi-1',
            {
              deliveredQuantity: 450,
              acceptedQuantity: 450,
              rejectedQuantity: 0,
              payableQuantity: 450,
            },
          ],
        ]),
      );
      goodsReceiptRepository.receive.mockResolvedValue({
        goodsReceipt: baseGoodsReceipt,
        purchaseOrderStatus: PurchaseOrderStatus.RECEIVED,
        journalEntry: null,
        wasCreated: true,
      });

      const result = await service.receiveGoods(
        'org-1',
        {
          purchaseOrderId: 'po-1',
          receivedDate: new Date('2026-08-10'),
          items: [{ purchaseOrderItemId: 'poi-1', deliveredQuantity: 50, rejectedQuantity: 0 }],
        },
        'user-2',
      );

      expect(result.isFirstReceipt).toBe(false);
    });

    it('throws NotFoundException when the purchase order does not exist in this organisation', async () => {
      const { service, purchaseOrderRepository } = makeService();
      purchaseOrderRepository.findById.mockResolvedValue(null);

      await expect(
        service.receiveGoods(
          'org-1',
          {
            purchaseOrderId: 'missing',
            receivedDate: new Date('2026-08-05'),
            items: [{ purchaseOrderItemId: 'poi-1', deliveredQuantity: 1, rejectedQuantity: 0 }],
          },
          'user-2',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects receiving a cancelled purchase order', async () => {
      const { service, purchaseOrderRepository } = makeService();
      purchaseOrderRepository.findById.mockResolvedValue(
        makePurchaseOrder(PurchaseOrderStatus.CANCELLED),
      );

      await expect(
        service.receiveGoods(
          'org-1',
          {
            purchaseOrderId: 'po-1',
            receivedDate: new Date('2026-08-05'),
            items: [{ purchaseOrderItemId: 'poi-1', deliveredQuantity: 1, rejectedQuantity: 0 }],
          },
          'user-2',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows receiving a RECEIVED purchase order (a supplier replacement shipment)', async () => {
      // Sprint 4.4.1 brief §6/§7 + test #17: duplicate protection is redesigned around
      // receipt identity, not a status gate — a fully RECEIVED order must still accept
      // a later replacement delivery.
      const { service, purchaseOrderRepository, goodsReceiptRepository } = makeService();
      purchaseOrderRepository.findById.mockResolvedValue(
        makePurchaseOrder(PurchaseOrderStatus.RECEIVED, 1000),
      );
      goodsReceiptRepository.getReceivingTotals.mockResolvedValue(
        new Map([
          [
            'poi-1',
            {
              deliveredQuantity: 1000,
              acceptedQuantity: 950,
              rejectedQuantity: 50,
              payableQuantity: 950,
            },
          ],
        ]),
      );
      goodsReceiptRepository.receive.mockResolvedValue({
        goodsReceipt: baseGoodsReceipt,
        purchaseOrderStatus: PurchaseOrderStatus.RECEIVED,
        journalEntry: null,
        wasCreated: true,
      });

      const result = await service.receiveGoods(
        'org-1',
        {
          purchaseOrderId: 'po-1',
          receivedDate: new Date('2026-08-12'),
          items: [{ purchaseOrderItemId: 'poi-1', deliveredQuantity: 50, rejectedQuantity: 0 }],
        },
        'user-2',
      );

      expect(goodsReceiptRepository.receive).toHaveBeenCalled();
      expect(result.isFirstReceipt).toBe(false);
    });

    it('rejects receiving a draft purchase order', async () => {
      const { service, purchaseOrderRepository } = makeService();
      purchaseOrderRepository.findById.mockResolvedValue(
        makePurchaseOrder(PurchaseOrderStatus.DRAFT),
      );

      await expect(
        service.receiveGoods(
          'org-1',
          {
            purchaseOrderId: 'po-1',
            receivedDate: new Date('2026-08-05'),
            items: [{ purchaseOrderItemId: 'poi-1', deliveredQuantity: 1, rejectedQuantity: 0 }],
          },
          'user-2',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an item whose purchaseOrderItemId is not on the purchase order', async () => {
      const { service, purchaseOrderRepository } = makeService();
      purchaseOrderRepository.findById.mockResolvedValue(
        makePurchaseOrder(PurchaseOrderStatus.PENDING),
      );

      await expect(
        service.receiveGoods(
          'org-1',
          {
            purchaseOrderId: 'po-1',
            receivedDate: new Date('2026-08-05'),
            items: [
              { purchaseOrderItemId: 'not-on-po', deliveredQuantity: 1, rejectedQuantity: 0 },
            ],
          },
          'user-2',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('translates a repository-level conflict (concurrent receive) into a BadRequestException', async () => {
      const { service, purchaseOrderRepository, goodsReceiptRepository } = makeService();
      purchaseOrderRepository.findById.mockResolvedValue(
        makePurchaseOrder(PurchaseOrderStatus.PENDING),
      );
      goodsReceiptRepository.receive.mockRejectedValue(
        new GoodsReceiptConflictError('no longer eligible'),
      );

      await expect(
        service.receiveGoods(
          'org-1',
          {
            purchaseOrderId: 'po-1',
            receivedDate: new Date('2026-08-05'),
            items: [{ purchaseOrderItemId: 'poi-1', deliveredQuantity: 500, rejectedQuantity: 0 }],
          },
          'user-2',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('increments the GRN number sequence on collision', async () => {
      const { service, purchaseOrderRepository, goodsReceiptRepository } = makeService();
      purchaseOrderRepository.findById.mockResolvedValue(
        makePurchaseOrder(PurchaseOrderStatus.PENDING, 500),
      );
      goodsReceiptRepository.existsByNumber
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);
      goodsReceiptRepository.receive.mockResolvedValue({
        goodsReceipt: baseGoodsReceipt,
        purchaseOrderStatus: PurchaseOrderStatus.RECEIVED,
        journalEntry: null,
        wasCreated: true,
      });

      await service.receiveGoods(
        'org-1',
        {
          purchaseOrderId: 'po-1',
          receivedDate: new Date('2026-08-05'),
          items: [{ purchaseOrderItemId: 'poi-1', deliveredQuantity: 500, rejectedQuantity: 0 }],
        },
        'user-2',
      );

      expect(goodsReceiptRepository.receive).toHaveBeenCalledWith(
        expect.objectContaining({ goodsReceiptNumber: 'GRN-000002' }),
      );
    });
  });

  describe('getPurchaseOrderReceivingSummary', () => {
    it('Scenario B/D/E — computes outstanding and excess correctly per item', async () => {
      const { service, purchaseOrderRepository, goodsReceiptRepository } = makeService();
      const po = makePurchaseOrder(PurchaseOrderStatus.PARTIALLY_RECEIVED, 500);
      po.items = [
        { ...po.items[0]!, id: 'poi-short', quantity: 500 }, // Scenario B: 450 delivered
        { ...po.items[0]!, id: 'poi-exact', quantity: 500 }, // Scenario A: 500 delivered
        { ...po.items[0]!, id: 'poi-excess', quantity: 1000 }, // Scenario E: 1100 delivered
      ];
      purchaseOrderRepository.findById.mockResolvedValue(po);
      goodsReceiptRepository.getReceivingTotals.mockResolvedValue(
        new Map([
          [
            'poi-short',
            {
              deliveredQuantity: 450,
              acceptedQuantity: 450,
              rejectedQuantity: 0,
              payableQuantity: 450,
            },
          ],
          [
            'poi-exact',
            {
              deliveredQuantity: 500,
              acceptedQuantity: 480,
              rejectedQuantity: 20,
              payableQuantity: 480,
            },
          ],
          [
            'poi-excess',
            {
              deliveredQuantity: 1100,
              acceptedQuantity: 1050,
              rejectedQuantity: 50,
              payableQuantity: 1050,
            },
          ],
        ]),
      );
      goodsReceiptRepository.findManyByOrganisation.mockResolvedValue([]);

      const summary = await service.getPurchaseOrderReceivingSummary('org-1', 'po-1');

      const short = summary.items.find((item) => item.purchaseOrderItemId === 'poi-short')!;
      expect(short.outstandingQuantity).toBe(50);
      expect(short.excessQuantity).toBe(0);

      const exact = summary.items.find((item) => item.purchaseOrderItemId === 'poi-exact')!;
      expect(exact.outstandingQuantity).toBe(0);
      expect(exact.excessQuantity).toBe(0);
      expect(exact.rejectedQuantity).toBe(20);

      const excess = summary.items.find((item) => item.purchaseOrderItemId === 'poi-excess')!;
      expect(excess.outstandingQuantity).toBe(0);
      expect(excess.excessQuantity).toBe(100);
    });

    it('throws NotFoundException when the purchase order does not exist in this organisation', async () => {
      const { service, purchaseOrderRepository } = makeService();
      purchaseOrderRepository.findById.mockResolvedValue(null);

      await expect(service.getPurchaseOrderReceivingSummary('org-1', 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('updateDiscrepancyStatus', () => {
    it('throws NotFoundException when no goods receipt matched', async () => {
      const { service, goodsReceiptRepository } = makeService();
      goodsReceiptRepository.updateDiscrepancyStatus.mockResolvedValue(null);

      await expect(
        service.updateDiscrepancyStatus('org-1', 'missing', DiscrepancyStatus.RESOLVED, undefined),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns the updated goods receipt', async () => {
      const { service, goodsReceiptRepository } = makeService();
      goodsReceiptRepository.updateDiscrepancyStatus.mockResolvedValue({
        ...baseGoodsReceipt,
        discrepancyStatus: DiscrepancyStatus.RESOLVED,
      });

      const result = await service.updateDiscrepancyStatus(
        'org-1',
        'gr-1',
        DiscrepancyStatus.RESOLVED,
        'Replacement received in full',
      );

      expect(goodsReceiptRepository.updateDiscrepancyStatus).toHaveBeenCalledWith(
        'org-1',
        'gr-1',
        DiscrepancyStatus.RESOLVED,
        'Replacement received in full',
        undefined,
      );
      expect(result.discrepancyStatus).toBe(DiscrepancyStatus.RESOLVED);
    });
  });

  describe('getStockByProduct', () => {
    it('returns the aggregated stock across locations when it exists', async () => {
      const { service, inventoryStockRepository, productRepository } = makeService();
      productRepository.findById.mockResolvedValue(product);
      inventoryStockRepository.findManyByProduct.mockResolvedValue([
        {
          id: 'stock-1',
          organisationId: 'org-1',
          productId: 'product-1',
          locationId: 'loc-1',
          quantityOnHand: 300,
          quantityReserved: 0,
          createdAt: new Date('2026-08-05'),
          updatedAt: new Date('2026-08-05'),
          product: {
            id: 'product-1',
            code: 'PRD-000009',
            name: 'Salt',
            type: ProductType.RAW_MATERIAL,
            unit: 'Kilogram',
            status: 'ACTIVE',
          },
          location: { id: 'loc-1', name: 'Main Warehouse' },
        },
      ] as never);

      const result = await service.getStockByProduct('org-1', 'product-1');

      expect(result.quantityOnHand).toBe(300);
      expect(result.quantityAvailable).toBe(300);
    });

    it('returns a zero-balance view when the product exists but has never been received', async () => {
      const { service, inventoryStockRepository, productRepository } = makeService();
      inventoryStockRepository.findManyByProduct.mockResolvedValue([]);
      productRepository.findById.mockResolvedValue(product);

      const result = await service.getStockByProduct('org-1', 'product-1');

      expect(result.quantityOnHand).toBe(0);
      expect(result.updatedAt).toBeNull();
    });

    it('throws NotFoundException when the product does not exist in this organisation', async () => {
      const { service, inventoryStockRepository, productRepository } = makeService();
      inventoryStockRepository.findManyByProduct.mockResolvedValue([]);
      productRepository.findById.mockResolvedValue(null);

      await expect(service.getStockByProduct('org-1', 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('adjustStock', () => {
    it('applies a positive adjustment and returns the new balance', async () => {
      const { service, inventoryStockRepository, productRepository } = makeService();
      productRepository.findById.mockResolvedValue(product);
      inventoryStockRepository.findByProductAndLocation.mockResolvedValue({
        id: 'stock-1',
        organisationId: 'org-1',
        productId: 'product-1',
        locationId: 'loc-1',
        quantityOnHand: 100,
        quantityReserved: 0,
        createdAt: new Date('2026-08-05'),
        updatedAt: new Date('2026-08-05'),
        product: {
          id: 'product-1',
          code: 'PRD-000009',
          name: 'Salt',
          type: ProductType.RAW_MATERIAL,
          unit: 'Kilogram',
          status: 'ACTIVE',
        },
        location: { id: 'loc-1', name: 'Main Warehouse' },
      } as never);
      inventoryStockRepository.adjustStock.mockResolvedValue({
        stock: { quantityOnHand: 110 } as never,
        transaction: { id: 'txn-1' } as never,
      });

      const result = await service.adjustStock(
        'org-1',
        { productId: 'product-1', quantity: 10, reason: 'PHYSICAL_COUNT' },
        'user-2',
      );

      expect(result.previousQuantity).toBe(100);
      expect(result.newQuantity).toBe(110);
      expect(inventoryStockRepository.adjustStock).toHaveBeenCalledWith(
        expect.objectContaining({ productId: 'product-1', locationId: 'loc-1', quantity: 10 }),
      );
    });

    it('translates a repository-level negative-stock guard into a BadRequestException', async () => {
      const { service, inventoryStockRepository, productRepository } = makeService();
      productRepository.findById.mockResolvedValue(product);
      inventoryStockRepository.findByProductAndLocation.mockResolvedValue(null);
      inventoryStockRepository.adjustStock.mockRejectedValue(
        new (jest.requireActual('./inventory-stock.repository').NegativeStockError)(
          'Adjustment would result in negative stock',
        ),
      );

      await expect(
        service.adjustStock(
          'org-1',
          { productId: 'product-1', quantity: -10, reason: 'DAMAGE' },
          'user-2',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when the product does not exist in this organisation', async () => {
      const { service, productRepository } = makeService();
      productRepository.findById.mockResolvedValue(null);

      await expect(
        service.adjustStock(
          'org-1',
          { productId: 'missing', quantity: 5, reason: 'FOUND_STOCK' },
          'user-2',
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ---------------------------------------------------------------------
  // Phase 2A — Customer-Location Inventory Foundation
  // (docs/customer-location-inventory-architecture-audit.md §7). Schema/
  // backward-compatibility coverage for `locationType`/`outletId` — no transfer,
  // outlet-stock, or Collection Point workflow exists to test yet (deliberately
  // out of scope for this phase).
  // ---------------------------------------------------------------------
  describe('createLocation', () => {
    it('backward compatible: omitting locationType/outletId still creates a WAREHOUSE with no outlet, exactly as before Phase 2A', async () => {
      const { service, inventoryLocationRepository } = makeService();
      inventoryLocationRepository.create.mockResolvedValue({
        ...defaultLocation,
        id: 'loc-2',
        isDefault: false,
      });

      await service.createLocation('org-1', { name: 'Cold Storage' } as never, 'user-1');

      expect(inventoryLocationRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Cold Storage', locationType: 'WAREHOUSE' }),
      );
      expect(inventoryLocationRepository.create.mock.calls[0]?.[0]).not.toHaveProperty('outlet');
      expect(inventoryLocationRepository.outletExists).not.toHaveBeenCalled();
    });

    it('creates a CUSTOMER_LOCATION when a valid, same-organisation outletId is supplied', async () => {
      const { service, inventoryLocationRepository } = makeService();
      inventoryLocationRepository.outletExists.mockResolvedValue(true);
      inventoryLocationRepository.create.mockResolvedValue({
        ...defaultLocation,
        id: 'loc-3',
        isDefault: false,
        locationType: 'CUSTOMER_LOCATION',
        outletId: 'outlet-1',
      });

      const result = await service.createLocation(
        'org-1',
        {
          name: 'Bodija Branch Stock',
          locationType: 'CUSTOMER_LOCATION',
          outletId: 'outlet-1',
        } as never,
        'user-1',
      );

      expect(inventoryLocationRepository.outletExists).toHaveBeenCalledWith('org-1', 'outlet-1');
      expect(inventoryLocationRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          locationType: 'CUSTOMER_LOCATION',
          outlet: { connect: { id: 'outlet-1' } },
        }),
      );
      expect(result.locationType).toBe('CUSTOMER_LOCATION');
      expect(result.outletId).toBe('outlet-1');
    });

    it('rejects a CUSTOMER_LOCATION with no outletId', async () => {
      const { service, inventoryLocationRepository } = makeService();

      await expect(
        service.createLocation(
          'org-1',
          { name: 'Invalid', locationType: 'CUSTOMER_LOCATION' } as never,
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(inventoryLocationRepository.create).not.toHaveBeenCalled();
    });

    it('rejects a WAREHOUSE with an outletId supplied', async () => {
      const { service, inventoryLocationRepository } = makeService();

      await expect(
        service.createLocation(
          'org-1',
          { name: 'Invalid', locationType: 'WAREHOUSE', outletId: 'outlet-1' } as never,
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(inventoryLocationRepository.create).not.toHaveBeenCalled();
    });

    it('rejects a cross-tenant / nonexistent outletId — the established validation mechanism', async () => {
      const { service, inventoryLocationRepository } = makeService();
      inventoryLocationRepository.outletExists.mockResolvedValue(false);

      await expect(
        service.createLocation(
          'org-1',
          {
            name: 'Invalid',
            locationType: 'CUSTOMER_LOCATION',
            outletId: 'other-org-outlet',
          } as never,
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(inventoryLocationRepository.outletExists).toHaveBeenCalledWith(
        'org-1',
        'other-org-outlet',
      );
      expect(inventoryLocationRepository.create).not.toHaveBeenCalled();
    });

    it('Phase 2B: rejects a second CUSTOMER_LOCATION for an outlet that already has one', async () => {
      const { service, inventoryLocationRepository } = makeService();
      inventoryLocationRepository.outletExists.mockResolvedValue(true);
      inventoryLocationRepository.findByOutletId.mockResolvedValue({
        ...defaultLocation,
        id: 'loc-existing',
        locationType: 'CUSTOMER_LOCATION',
        outletId: 'outlet-1',
      });

      await expect(
        service.createLocation(
          'org-1',
          { name: 'Duplicate', locationType: 'CUSTOMER_LOCATION', outletId: 'outlet-1' } as never,
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(inventoryLocationRepository.create).not.toHaveBeenCalled();
    });
  });

  describe('createTransfer (Phase 2B)', () => {
    const sourceLocation = { ...defaultLocation, id: 'loc-1' };
    const destinationLocation = {
      ...defaultLocation,
      id: 'loc-2',
      isDefault: false,
      locationType: 'CUSTOMER_LOCATION' as const,
      outletId: 'outlet-1',
    };
    const transferRecord = {
      id: 'transfer-1',
      organisationId: 'org-1',
      transferNumber: 'TRF-000001',
      productId: 'product-1',
      product: { id: 'product-1', code: 'PRD-000009', name: 'Salt', unit: 'Kilogram' },
      sourceLocationId: 'loc-1',
      sourceLocation: { id: 'loc-1', name: 'Main Warehouse' },
      destinationLocationId: 'loc-2',
      destinationLocation: { id: 'loc-2', name: 'Bodija Branch Stock' },
      quantity: 10,
      ownership: 'ORGANISATION' as const,
      arrangement: 'WHOLESALE' as const,
      status: 'COMPLETED' as const,
      notes: null,
      idempotencyKey: null,
      reversalOfTransferId: null,
      createdById: 'user-1',
      createdAt: new Date('2026-10-12'),
    };

    function mockLocations(
      inventoryLocationRepository: ReturnType<typeof makeService>['inventoryLocationRepository'],
    ) {
      inventoryLocationRepository.findById.mockImplementation((_org: string, id: string) =>
        Promise.resolve(
          id === 'loc-1' ? sourceLocation : id === 'loc-2' ? destinationLocation : null,
        ),
      );
    }

    it('creates a transfer between two valid same-organisation locations', async () => {
      const { service, inventoryLocationRepository, inventoryTransferRepository } = makeService();
      mockLocations(inventoryLocationRepository);
      inventoryTransferRepository.create.mockResolvedValue({
        transfer: transferRecord,
        wasCreated: true,
      });

      const result = await service.createTransfer(
        'org-1',
        {
          productId: 'product-1',
          sourceLocationId: 'loc-1',
          destinationLocationId: 'loc-2',
          quantity: 10,
        } as never,
        'user-1',
      );

      expect(inventoryTransferRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          organisationId: 'org-1',
          productId: 'product-1',
          sourceLocationId: 'loc-1',
          destinationLocationId: 'loc-2',
          quantity: 10,
          createdById: 'user-1',
        }),
      );
      expect(result.wasCreated).toBe(true);
      expect(result.transferNumber).toBe('TRF-000001');
    });

    it('404s when the product does not exist in this organisation', async () => {
      const { service, productRepository } = makeService();
      productRepository.findById.mockResolvedValue(null);

      await expect(
        service.createTransfer(
          'org-1',
          {
            productId: 'missing',
            sourceLocationId: 'loc-1',
            destinationLocationId: 'loc-2',
            quantity: 10,
          } as never,
          'user-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('404s when the source location is unknown or belongs to another tenant', async () => {
      const { service, inventoryLocationRepository } = makeService();
      inventoryLocationRepository.findById.mockResolvedValue(null);

      await expect(
        service.createTransfer(
          'org-1',
          {
            productId: 'product-1',
            sourceLocationId: 'other-org-loc',
            destinationLocationId: 'loc-2',
            quantity: 10,
          } as never,
          'user-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('translates InsufficientStockError into a 400', async () => {
      const { service, inventoryLocationRepository, inventoryTransferRepository } = makeService();
      mockLocations(inventoryLocationRepository);
      inventoryTransferRepository.create.mockRejectedValue(
        new InsufficientStockError('Insufficient stock at the source location'),
      );

      await expect(
        service.createTransfer(
          'org-1',
          {
            productId: 'product-1',
            sourceLocationId: 'loc-1',
            destinationLocationId: 'loc-2',
            quantity: 10,
          } as never,
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('translates OwnershipMismatchError into a 400', async () => {
      const { service, inventoryLocationRepository, inventoryTransferRepository } = makeService();
      mockLocations(inventoryLocationRepository);
      inventoryTransferRepository.create.mockRejectedValue(
        new OwnershipMismatchError('Destination holds a different ownership/arrangement'),
      );

      await expect(
        service.createTransfer(
          'org-1',
          {
            productId: 'product-1',
            sourceLocationId: 'loc-1',
            destinationLocationId: 'loc-2',
            quantity: 10,
          } as never,
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('an idempotent replay returns the original transfer without re-creating it', async () => {
      const { service, inventoryLocationRepository, inventoryTransferRepository } = makeService();
      mockLocations(inventoryLocationRepository);
      inventoryTransferRepository.create.mockResolvedValue({
        transfer: transferRecord,
        wasCreated: false,
      });

      const result = await service.createTransfer(
        'org-1',
        {
          productId: 'product-1',
          sourceLocationId: 'loc-1',
          destinationLocationId: 'loc-2',
          quantity: 10,
          idempotencyKey: 'key-1',
        } as never,
        'user-1',
      );

      expect(result.wasCreated).toBe(false);
      expect(result.id).toBe('transfer-1');
    });
  });

  describe('reverseTransfer (Phase 2B)', () => {
    const transferRecord = {
      id: 'transfer-1',
      organisationId: 'org-1',
      transferNumber: 'TRF-000001',
      productId: 'product-1',
      product: { id: 'product-1', code: 'PRD-000009', name: 'Salt', unit: 'Kilogram' },
      sourceLocationId: 'loc-1',
      sourceLocation: { id: 'loc-1', name: 'Main Warehouse' },
      destinationLocationId: 'loc-2',
      destinationLocation: { id: 'loc-2', name: 'Bodija Branch Stock' },
      quantity: 10,
      ownership: 'ORGANISATION' as const,
      arrangement: 'WHOLESALE' as const,
      status: 'COMPLETED' as const,
      notes: null,
      idempotencyKey: null,
      reversalOfTransferId: null,
      createdById: 'user-1',
      createdAt: new Date('2026-10-12'),
    };

    it('404s when the transfer does not exist in this organisation', async () => {
      const { service, inventoryTransferRepository } = makeService();
      inventoryTransferRepository.findById.mockResolvedValue(null);

      await expect(
        service.reverseTransfer('org-1', 'missing', undefined, 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('reverses a COMPLETED transfer', async () => {
      const { service, inventoryTransferRepository } = makeService();
      inventoryTransferRepository.findById.mockResolvedValue(transferRecord);
      inventoryTransferRepository.reverse.mockResolvedValue({
        transfer: {
          ...transferRecord,
          id: 'transfer-2',
          transferNumber: 'TRF-000002',
          sourceLocation: transferRecord.destinationLocation,
          destinationLocation: transferRecord.sourceLocation,
          reversalOfTransferId: 'transfer-1',
        },
        wasCreated: true,
      });

      const result = await service.reverseTransfer(
        'org-1',
        'transfer-1',
        'count discrepancy',
        'user-1',
      );

      expect(result.reversalOfTransferId).toBe('transfer-1');
      expect(inventoryTransferRepository.reverse).toHaveBeenCalledWith(
        'org-1',
        'transfer-1',
        'TRF-000001',
        'count discrepancy',
        'user-1',
      );
    });

    it('translates TransferNotReversibleError (already reversed) into a 400', async () => {
      const { service, inventoryTransferRepository } = makeService();
      inventoryTransferRepository.findById.mockResolvedValue(transferRecord);
      inventoryTransferRepository.reverse.mockRejectedValue(
        new TransferNotReversibleError('Already reversed'),
      );

      await expect(
        service.reverseTransfer('org-1', 'transfer-1', undefined, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('translates InsufficientStockError (destination moved on) into a 400', async () => {
      const { service, inventoryTransferRepository } = makeService();
      inventoryTransferRepository.findById.mockResolvedValue(transferRecord);
      inventoryTransferRepository.reverse.mockRejectedValue(
        new InsufficientStockError('Destination no longer holds enough stock'),
      );

      await expect(
        service.reverseTransfer('org-1', 'transfer-1', undefined, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('recordOpeningStock (Phase 2B)', () => {
    const customerLocation = {
      ...defaultLocation,
      id: 'loc-2',
      isDefault: false,
      locationType: 'CUSTOMER_LOCATION' as const,
      outletId: 'outlet-1',
    };

    it('404s when the product does not exist in this organisation', async () => {
      const { service, productRepository } = makeService();
      productRepository.findById.mockResolvedValue(null);

      await expect(
        service.recordOpeningStock(
          'org-1',
          'loc-1',
          { productId: 'missing', quantity: 10, ownership: 'ORGANISATION' } as never,
          'user-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects CUSTOMER ownership at a WAREHOUSE location', async () => {
      const { service, inventoryLocationRepository } = makeService();
      inventoryLocationRepository.findById.mockResolvedValue(defaultLocation);

      await expect(
        service.recordOpeningStock(
          'org-1',
          'loc-1',
          { productId: 'product-1', quantity: 10, ownership: 'CUSTOMER' } as never,
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts ORGANISATION ownership at a WAREHOUSE location', async () => {
      const { service, inventoryLocationRepository, inventoryStockRepository } = makeService();
      inventoryLocationRepository.findById.mockResolvedValue(defaultLocation);
      inventoryStockRepository.recordOpeningStock.mockResolvedValue({
        stock: {
          quantityOnHand: 10,
          ownership: 'ORGANISATION',
          arrangement: 'WHOLESALE',
        } as never,
        transaction: { id: 'txn-1' } as never,
      });

      const result = await service.recordOpeningStock(
        'org-1',
        'loc-1',
        { productId: 'product-1', quantity: 10, ownership: 'ORGANISATION' } as never,
        'user-1',
      );

      expect(result.quantity).toBe(10);
      expect(inventoryStockRepository.recordOpeningStock).toHaveBeenCalledWith(
        expect.objectContaining({ ownership: 'ORGANISATION', arrangement: 'WHOLESALE' }),
      );
    });

    it('accepts CUSTOMER ownership at a CUSTOMER_LOCATION', async () => {
      const { service, inventoryLocationRepository, inventoryStockRepository } = makeService();
      inventoryLocationRepository.findById.mockResolvedValue(customerLocation);
      inventoryStockRepository.recordOpeningStock.mockResolvedValue({
        stock: { quantityOnHand: 25, ownership: 'CUSTOMER', arrangement: 'WHOLESALE' } as never,
        transaction: { id: 'txn-2' } as never,
      });

      const result = await service.recordOpeningStock(
        'org-1',
        'loc-2',
        { productId: 'product-1', quantity: 25, ownership: 'CUSTOMER' } as never,
        'user-1',
      );

      expect(result.ownership).toBe('CUSTOMER');
    });

    it('translates OpeningStockAlreadyRecordedError into a 400', async () => {
      const { service, inventoryLocationRepository, inventoryStockRepository } = makeService();
      inventoryLocationRepository.findById.mockResolvedValue(defaultLocation);
      inventoryStockRepository.recordOpeningStock.mockRejectedValue(
        new OpeningStockAlreadyRecordedError('Already recorded'),
      );

      await expect(
        service.recordOpeningStock(
          'org-1',
          'loc-1',
          { productId: 'product-1', quantity: 10, ownership: 'ORGANISATION' } as never,
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
