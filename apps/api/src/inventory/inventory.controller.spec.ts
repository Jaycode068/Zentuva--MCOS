import { NotFoundException } from '@nestjs/common';
import { DiscrepancyStatus, PurchaseOrderStatus } from '@prisma/client';
import { Request } from 'express';

import { AuditService } from '../identity/audit/audit.service';
import { TokenPayload } from '../identity/auth/ports/token.port';
import { GoodsReceiptWithRelations } from './goods-receipt.repository';
import { InventoryController } from './inventory.controller';
import { InventoryService, ReceiveGoodsResult } from './inventory.service';
import { INVENTORY_AUDIT_ACTIONS } from './inventory-audit-actions';

describe('InventoryController', () => {
  const tokenUser: TokenPayload = {
    sub: 'user-2',
    organisationId: 'org-1',
    sessionId: 'session-1',
  };

  function makeGoodsReceipt(
    overrides: Partial<GoodsReceiptWithRelations['items'][number]> = {},
  ): GoodsReceiptWithRelations {
    return {
      id: 'gr-1',
      organisationId: 'org-1',
      goodsReceiptNumber: 'GRN-000002',
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
          ...overrides,
        },
      ],
      supplier: { id: 'supplier-1', supplierCode: 'SUP-000004', supplierName: 'Salt Masters Ltd' },
      purchaseOrder: { id: 'po-1', purchaseOrderNumber: 'PO-000004' },
    };
  }

  function makeController() {
    const inventoryService = {
      listStock: jest.fn(),
      getStockByProduct: jest.fn(),
      listTransactions: jest.fn(),
      listGoodsReceipts: jest.fn(),
      getGoodsReceiptById: jest.fn(),
      receiveGoods: jest.fn(),
      updateDiscrepancyStatus: jest.fn(),
      getPurchaseOrderReceivingSummary: jest.fn(),
    } as unknown as jest.Mocked<InventoryService>;
    const auditService = { record: jest.fn() } as unknown as jest.Mocked<AuditService>;

    const controller = new InventoryController(inventoryService, auditService);
    return { controller, inventoryService, auditService };
  }

  const req = { ip: '127.0.0.1', headers: { 'user-agent': 'jest' } } as unknown as Request;

  describe('list', () => {
    it('passes the trimmed search query and product type filter through', async () => {
      const { controller, inventoryService } = makeController();
      inventoryService.listStock.mockResolvedValue([
        {
          productId: 'product-1',
          product: {
            id: 'product-1',
            code: 'PRD-000009',
            name: 'Salt',
            type: 'RAW_MATERIAL',
            unit: 'Kilogram',
          },
          quantityOnHand: 480,
          updatedAt: new Date('2026-08-05'),
        },
      ]);

      const result = await controller.list(tokenUser, '  salt  ', 'RAW_MATERIAL');

      expect(inventoryService.listStock).toHaveBeenCalledWith('org-1', {
        search: 'salt',
        productType: 'RAW_MATERIAL',
      });
      expect(result.items[0]?.quantityOnHand).toBe(480);
    });
  });

  describe('createGoodsReceipt', () => {
    it('always records goods-receipt.received and inventory.increased', async () => {
      const { controller, inventoryService, auditService } = makeController();
      const goodsReceipt = makeGoodsReceipt();
      const receiveResult: ReceiveGoodsResult = {
        goodsReceipt,
        purchaseOrderStatus: PurchaseOrderStatus.RECEIVED,
        isFirstReceipt: true,
        hasDiscrepancy: false,
      };
      inventoryService.receiveGoods.mockResolvedValue(receiveResult);

      const result = await controller.createGoodsReceipt(
        {
          purchaseOrderId: 'po-1',
          receivedDate: new Date('2026-08-05'),
          items: [{ purchaseOrderItemId: 'poi-1', deliveredQuantity: 500, rejectedQuantity: 0 }],
        },
        tokenUser,
        req,
      );

      expect(inventoryService.receiveGoods).toHaveBeenCalledWith(
        'org-1',
        expect.objectContaining({ purchaseOrderId: 'po-1' }),
        'user-2',
      );
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: INVENTORY_AUDIT_ACTIONS.GOODS_RECEIVED,
          entityId: 'gr-1',
        }),
      );
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: INVENTORY_AUDIT_ACTIONS.INVENTORY_INCREASED }),
      );
      expect(auditService.record).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: INVENTORY_AUDIT_ACTIONS.DISCREPANCY_RECORDED }),
      );
      expect(auditService.record).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: INVENTORY_AUDIT_ACTIONS.REPLACEMENT_RECEIVED }),
      );
      expect(result.goodsReceiptNumber).toBe('GRN-000002');
    });

    it('records goods-receipt.discrepancy-recorded when the receipt has a rejection', async () => {
      const { controller, inventoryService, auditService } = makeController();
      const goodsReceipt = makeGoodsReceipt({
        deliveredQuantity: 500,
        rejectedQuantity: 20,
        acceptedQuantity: 480,
        rejectionReason: 'DEFECTIVE',
      });
      inventoryService.receiveGoods.mockResolvedValue({
        goodsReceipt,
        purchaseOrderStatus: PurchaseOrderStatus.RECEIVED,
        isFirstReceipt: true,
        hasDiscrepancy: true,
      });

      await controller.createGoodsReceipt(
        {
          purchaseOrderId: 'po-1',
          receivedDate: new Date('2026-08-05'),
          items: [
            {
              purchaseOrderItemId: 'poi-1',
              deliveredQuantity: 500,
              rejectedQuantity: 20,
              rejectionReason: 'DEFECTIVE',
            },
          ],
        },
        tokenUser,
        req,
      );

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: INVENTORY_AUDIT_ACTIONS.DISCREPANCY_RECORDED }),
      );
    });

    it('records goods-receipt.replacement-received when this is not the first receipt for the order', async () => {
      const { controller, inventoryService, auditService } = makeController();
      const goodsReceipt = makeGoodsReceipt();
      inventoryService.receiveGoods.mockResolvedValue({
        goodsReceipt,
        purchaseOrderStatus: PurchaseOrderStatus.PARTIALLY_RECEIVED,
        isFirstReceipt: false,
        hasDiscrepancy: false,
      });

      await controller.createGoodsReceipt(
        {
          purchaseOrderId: 'po-1',
          receivedDate: new Date('2026-08-10'),
          items: [{ purchaseOrderItemId: 'poi-1', deliveredQuantity: 50, rejectedQuantity: 0 }],
        },
        tokenUser,
        req,
      );

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: INVENTORY_AUDIT_ACTIONS.REPLACEMENT_RECEIVED }),
      );
    });

    it('does not record inventory.increased when every item was fully rejected', async () => {
      const { controller, inventoryService, auditService } = makeController();
      const goodsReceipt = makeGoodsReceipt({
        deliveredQuantity: 20,
        rejectedQuantity: 20,
        acceptedQuantity: 0,
        rejectionReason: 'DAMAGED',
      });
      inventoryService.receiveGoods.mockResolvedValue({
        goodsReceipt,
        purchaseOrderStatus: PurchaseOrderStatus.PARTIALLY_RECEIVED,
        isFirstReceipt: false,
        hasDiscrepancy: true,
      });

      await controller.createGoodsReceipt(
        {
          purchaseOrderId: 'po-1',
          receivedDate: new Date('2026-08-10'),
          items: [
            {
              purchaseOrderItemId: 'poi-1',
              deliveredQuantity: 20,
              rejectedQuantity: 20,
              rejectionReason: 'DAMAGED',
            },
          ],
        },
        tokenUser,
        req,
      );

      expect(auditService.record).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: INVENTORY_AUDIT_ACTIONS.INVENTORY_INCREASED }),
      );
    });
  });

  describe('updateDiscrepancy', () => {
    it('records goods-receipt.resolved only when the new status is RESOLVED', async () => {
      const { controller, inventoryService, auditService } = makeController();
      inventoryService.updateDiscrepancyStatus.mockResolvedValue(
        makeGoodsReceipt() as unknown as ReturnType<typeof makeGoodsReceipt>,
      );

      await controller.updateDiscrepancy('gr-1', { status: 'RESOLVED' }, tokenUser, req);

      expect(inventoryService.updateDiscrepancyStatus).toHaveBeenCalledWith(
        'org-1',
        'gr-1',
        'RESOLVED',
        undefined,
      );
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: INVENTORY_AUDIT_ACTIONS.RESOLVED }),
      );
    });

    it('does not audit a non-terminal status transition', async () => {
      const { controller, inventoryService, auditService } = makeController();
      inventoryService.updateDiscrepancyStatus.mockResolvedValue(makeGoodsReceipt());

      await controller.updateDiscrepancy(
        'gr-1',
        { status: 'REPLACEMENT_EXPECTED', notes: 'Supplier confirmed' },
        tokenUser,
        req,
      );

      expect(auditService.record).not.toHaveBeenCalled();
    });
  });

  describe('getPurchaseOrderReceivingSummary', () => {
    it('delegates to the service and maps the response', async () => {
      const { controller, inventoryService } = makeController();
      inventoryService.getPurchaseOrderReceivingSummary.mockResolvedValue({
        purchaseOrder: {
          id: 'po-1',
          purchaseOrderNumber: 'PO-000004',
          status: PurchaseOrderStatus.PARTIALLY_RECEIVED,
        },
        items: [
          {
            purchaseOrderItemId: 'poi-1',
            product: { id: 'product-1', code: 'PRD-000009', name: 'Salt', unit: 'Kilogram' },
            orderedQuantity: 500,
            deliveredQuantity: 450,
            acceptedQuantity: 450,
            rejectedQuantity: 0,
            outstandingQuantity: 50,
            excessQuantity: 0,
          },
        ],
        receipts: [makeGoodsReceipt()],
      });

      const result = await controller.getPurchaseOrderReceivingSummary(tokenUser, 'po-1');

      expect(inventoryService.getPurchaseOrderReceivingSummary).toHaveBeenCalledWith(
        'org-1',
        'po-1',
      );
      expect(result.items[0]?.outstandingQuantity).toBe(50);
      expect(result.receipts).toHaveLength(1);
    });
  });

  describe('getByProduct', () => {
    it('propagates NotFoundException from the service', async () => {
      const { controller, inventoryService } = makeController();
      inventoryService.getStockByProduct.mockRejectedValue(new NotFoundException());

      await expect(controller.getByProduct(tokenUser, 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
