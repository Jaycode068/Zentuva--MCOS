import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DiscrepancyStatus, Product, ProductType, PurchaseOrderStatus } from '@prisma/client';

import { ProductRepository } from '../catalogue/product/product.repository';
import {
  PurchaseOrderRepository,
  PurchaseOrderWithRelations,
} from '../procurement/purchase-order/purchase-order.repository';
import { GoodsReceiptConflictError, GoodsReceiptRepository } from './goods-receipt.repository';
import { InventoryService } from './inventory.service';
import { InventoryStockRepository } from './inventory-stock.repository';
import { InventoryTransactionRepository } from './inventory-transaction.repository';

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
        rejectionReason: null,
        rejectionNotes: null,
        createdAt: new Date('2026-08-05'),
        product: { id: 'product-1', code: 'PRD-000009', name: 'Salt', unit: 'Kilogram' },
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
      findByProduct: jest.fn(),
    } as unknown as jest.Mocked<InventoryStockRepository>;
    const inventoryTransactionRepository = {
      findManyByOrganisation: jest.fn(),
    } as unknown as jest.Mocked<InventoryTransactionRepository>;
    const purchaseOrderRepository = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<PurchaseOrderRepository>;
    const productRepository = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<ProductRepository>;

    const service = new InventoryService(
      goodsReceiptRepository,
      inventoryStockRepository,
      inventoryTransactionRepository,
      purchaseOrderRepository,
      productRepository,
    );
    return {
      service,
      goodsReceiptRepository,
      inventoryStockRepository,
      inventoryTransactionRepository,
      purchaseOrderRepository,
      productRepository,
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
          ['poi-1', { deliveredQuantity: 450, acceptedQuantity: 450, rejectedQuantity: 0 }],
        ]),
      );
      goodsReceiptRepository.receive.mockResolvedValue({
        goodsReceipt: baseGoodsReceipt,
        purchaseOrderStatus: PurchaseOrderStatus.RECEIVED,
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
          ['poi-1', { deliveredQuantity: 1000, acceptedQuantity: 950, rejectedQuantity: 50 }],
        ]),
      );
      goodsReceiptRepository.receive.mockResolvedValue({
        goodsReceipt: baseGoodsReceipt,
        purchaseOrderStatus: PurchaseOrderStatus.RECEIVED,
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
          ['poi-short', { deliveredQuantity: 450, acceptedQuantity: 450, rejectedQuantity: 0 }],
          ['poi-exact', { deliveredQuantity: 500, acceptedQuantity: 480, rejectedQuantity: 20 }],
          ['poi-excess', { deliveredQuantity: 1100, acceptedQuantity: 1050, rejectedQuantity: 50 }],
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
      );
      expect(result.discrepancyStatus).toBe(DiscrepancyStatus.RESOLVED);
    });
  });

  describe('getStockByProduct', () => {
    it('returns the stock row when one exists', async () => {
      const { service, inventoryStockRepository } = makeService();
      inventoryStockRepository.findByProduct.mockResolvedValue({
        id: 'stock-1',
        organisationId: 'org-1',
        productId: 'product-1',
        quantityOnHand: 300,
        createdAt: new Date('2026-08-05'),
        updatedAt: new Date('2026-08-05'),
        product: {
          id: 'product-1',
          code: 'PRD-000009',
          name: 'Salt',
          type: ProductType.RAW_MATERIAL,
          unit: 'Kilogram',
        },
      });

      const result = await service.getStockByProduct('org-1', 'product-1');

      expect(result.quantityOnHand).toBe(300);
    });

    it('returns a zero-balance view when the product exists but has never been received', async () => {
      const { service, inventoryStockRepository, productRepository } = makeService();
      inventoryStockRepository.findByProduct.mockResolvedValue(null);
      productRepository.findById.mockResolvedValue(product);

      const result = await service.getStockByProduct('org-1', 'product-1');

      expect(result.quantityOnHand).toBe(0);
      expect(result.updatedAt).toBeNull();
    });

    it('throws NotFoundException when the product does not exist in this organisation', async () => {
      const { service, inventoryStockRepository, productRepository } = makeService();
      inventoryStockRepository.findByProduct.mockResolvedValue(null);
      productRepository.findById.mockResolvedValue(null);

      await expect(service.getStockByProduct('org-1', 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
