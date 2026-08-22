import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SalesOrderStatus } from '@prisma/client';

import { InventoryLocationRepository } from '../inventory/inventory-location.repository';
import {
  InventoryStockRepository,
  InventoryStockWithProduct,
} from '../inventory/inventory-stock.repository';
import {
  FulfilSalesOrderResult,
  InsufficientStockError,
  SalesFulfilmentConflictError,
  SalesFulfilmentRepository,
  SalesFulfilmentWithItems,
} from './sales-fulfilment.repository';
import { SalesFulfilmentService } from './sales-fulfilment.service';
import { SalesOrderRepository, SalesOrderWithRelations } from './sales-order.repository';

describe('SalesFulfilmentService', () => {
  const confirmedOrder: SalesOrderWithRelations = {
    id: 'order-1',
    organisationId: 'org-1',
    orderCode: 'SO-000001',
    customerId: 'customer-1',
    outletId: 'outlet-1',
    salesAgentId: 'user-1',
    status: SalesOrderStatus.CONFIRMED,
    orderDate: new Date('2026-08-21'),
    notes: null,
    subtotal: 25000,
    discount: 0,
    total: 25000,
    createdById: 'user-1',
    updatedById: 'user-1',
    createdAt: new Date('2026-08-21'),
    updatedAt: new Date('2026-08-21'),
    customer: { id: 'customer-1', customerCode: 'CUS-000001', customerName: 'Bodija Supermart' },
    outlet: { id: 'outlet-1', outletCode: 'OUT-000001', name: 'Bodija Supermart — Main Branch' },
    items: [
      {
        id: 'item-1',
        productId: 'product-1',
        quantity: 100,
        quantityFulfilled: 0,
        unitPrice: 250,
        lineTotal: 25000,
        product: {
          id: 'product-1',
          code: 'PRD-000030',
          name: 'Plantain Chips 500g',
          unit: 'Carton',
        },
      },
    ],
  };

  function makeService() {
    const salesFulfilmentRepository = {
      create: jest.fn(),
      findManyBySalesOrder: jest.fn(),
    } as unknown as jest.Mocked<SalesFulfilmentRepository>;
    const salesOrderRepository = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<SalesOrderRepository>;
    const inventoryStockRepository = {
      findManyByProductsAndLocation: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<InventoryStockRepository>;
    const inventoryLocationRepository = {
      getOrCreateDefault: jest.fn().mockResolvedValue({ id: 'location-1' }),
    } as unknown as jest.Mocked<InventoryLocationRepository>;

    const service = new SalesFulfilmentService(
      salesFulfilmentRepository,
      salesOrderRepository,
      inventoryStockRepository,
      inventoryLocationRepository,
    );
    return {
      service,
      salesFulfilmentRepository,
      salesOrderRepository,
      inventoryStockRepository,
      inventoryLocationRepository,
    };
  }

  describe('getAvailability', () => {
    it('computes ordered/fulfilled/remaining/availableStock/shortfall per line', async () => {
      const { service, salesOrderRepository, inventoryStockRepository } = makeService();
      salesOrderRepository.findById.mockResolvedValue(confirmedOrder);
      inventoryStockRepository.findManyByProductsAndLocation.mockResolvedValue([
        { productId: 'product-1', quantityOnHand: 72 } as unknown as InventoryStockWithProduct,
      ]);

      const rows = await service.getAvailability('org-1', 'order-1', 'location-1');

      expect(rows).toEqual([
        expect.objectContaining({
          salesOrderItemId: 'item-1',
          ordered: 100,
          fulfilled: 0,
          remaining: 100,
          availableStock: 72,
          shortfall: 28,
        }),
      ]);
    });

    it('treats a product with no stock row as zero available and defaults to the org default location', async () => {
      const { service, salesOrderRepository, inventoryLocationRepository } = makeService();
      salesOrderRepository.findById.mockResolvedValue(confirmedOrder);

      const rows = await service.getAvailability('org-1', 'order-1');

      expect(inventoryLocationRepository.getOrCreateDefault).toHaveBeenCalledWith('org-1');
      expect(rows[0]).toEqual(expect.objectContaining({ availableStock: 0, shortfall: 100 }));
    });

    it('throws NotFoundException for an unknown/cross-tenant order', async () => {
      const { service, salesOrderRepository } = makeService();
      salesOrderRepository.findById.mockResolvedValue(null);

      await expect(service.getAvailability('org-1', 'order-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('fulfil', () => {
    it('rejects fulfilling a DRAFT order', async () => {
      const { service, salesOrderRepository } = makeService();
      salesOrderRepository.findById.mockResolvedValue({
        ...confirmedOrder,
        status: SalesOrderStatus.DRAFT,
      });

      await expect(
        service.fulfil(
          'org-1',
          'order-1',
          {
            locationId: 'location-1',
            fulfilmentDate: new Date(),
            items: [{ salesOrderItemId: 'item-1', quantity: 10 }],
          },
          'user-1',
        ),
      ).rejects.toThrow('Sales order must be confirmed before it can be fulfilled');
    });

    it('rejects fulfilling a cancelled order', async () => {
      const { service, salesOrderRepository } = makeService();
      salesOrderRepository.findById.mockResolvedValue({
        ...confirmedOrder,
        status: SalesOrderStatus.CANCELLED,
      });

      await expect(
        service.fulfil(
          'org-1',
          'order-1',
          {
            locationId: 'location-1',
            fulfilmentDate: new Date(),
            items: [{ salesOrderItemId: 'item-1', quantity: 10 }],
          },
          'user-1',
        ),
      ).rejects.toThrow('This sales order has been cancelled');
    });

    it('rejects fulfilling an already-FULFILLED order', async () => {
      const { service, salesOrderRepository } = makeService();
      salesOrderRepository.findById.mockResolvedValue({
        ...confirmedOrder,
        status: SalesOrderStatus.FULFILLED,
      });

      await expect(
        service.fulfil(
          'org-1',
          'order-1',
          {
            locationId: 'location-1',
            fulfilmentDate: new Date(),
            items: [{ salesOrderItemId: 'item-1', quantity: 10 }],
          },
          'user-1',
        ),
      ).rejects.toThrow('This sales order has already been fully fulfilled');
    });

    it('rejects an item that does not belong to this order', async () => {
      const { service, salesOrderRepository } = makeService();
      salesOrderRepository.findById.mockResolvedValue(confirmedOrder);

      await expect(
        service.fulfil(
          'org-1',
          'order-1',
          {
            locationId: 'location-1',
            fulfilmentDate: new Date(),
            items: [{ salesOrderItemId: 'not-an-item', quantity: 10 }],
          },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an over-fulfilment beyond the remaining quantity', async () => {
      const { service, salesOrderRepository, salesFulfilmentRepository } = makeService();
      salesOrderRepository.findById.mockResolvedValue(confirmedOrder);

      await expect(
        service.fulfil(
          'org-1',
          'order-1',
          {
            locationId: 'location-1',
            fulfilmentDate: new Date(),
            items: [{ salesOrderItemId: 'item-1', quantity: 150 }],
          },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(salesFulfilmentRepository.create).not.toHaveBeenCalled();
    });

    it('rejects an over-fulfilment that only exceeds when combined with prior fulfilments', async () => {
      const { service, salesOrderRepository } = makeService();
      salesOrderRepository.findById.mockResolvedValue({
        ...confirmedOrder,
        status: SalesOrderStatus.PARTIALLY_FULFILLED,
        items: [{ ...confirmedOrder.items[0]!, quantityFulfilled: 80 }],
      });

      await expect(
        service.fulfil(
          'org-1',
          'order-1',
          {
            locationId: 'location-1',
            fulfilmentDate: new Date(),
            items: [{ salesOrderItemId: 'item-1', quantity: 30 }],
          },
          'user-1',
        ),
      ).rejects.toThrow('only 20 Carton remains outstanding');
    });

    it('rejects fulfilling more than the currently available stock', async () => {
      const { service, salesOrderRepository, inventoryStockRepository, salesFulfilmentRepository } =
        makeService();
      salesOrderRepository.findById.mockResolvedValue(confirmedOrder);
      inventoryStockRepository.findManyByProductsAndLocation.mockResolvedValue([
        { productId: 'product-1', quantityOnHand: 50 } as unknown as InventoryStockWithProduct,
      ]);

      await expect(
        service.fulfil(
          'org-1',
          'order-1',
          {
            locationId: 'location-1',
            fulfilmentDate: new Date(),
            items: [{ salesOrderItemId: 'item-1', quantity: 80 }],
          },
          'user-1',
        ),
      ).rejects.toThrow('Insufficient stock');
      expect(salesFulfilmentRepository.create).not.toHaveBeenCalled();
    });

    it('allows a partial fulfilment within remaining/available and delegates to the repository', async () => {
      const { service, salesOrderRepository, inventoryStockRepository, salesFulfilmentRepository } =
        makeService();
      salesOrderRepository.findById.mockResolvedValue(confirmedOrder);
      inventoryStockRepository.findManyByProductsAndLocation.mockResolvedValue([
        { productId: 'product-1', quantityOnHand: 72 } as unknown as InventoryStockWithProduct,
      ]);
      const fulfilmentResult: FulfilSalesOrderResult = {
        fulfilment: { id: 'fulfilment-1', items: [] } as unknown as SalesFulfilmentWithItems,
        order: { ...confirmedOrder, status: SalesOrderStatus.PARTIALLY_FULFILLED },
        wasCreated: true,
      };
      salesFulfilmentRepository.create.mockResolvedValue(fulfilmentResult);

      const result = await service.fulfil(
        'org-1',
        'order-1',
        {
          locationId: 'location-1',
          fulfilmentDate: new Date('2026-08-22'),
          idempotencyKey: 'key-1',
          items: [{ salesOrderItemId: 'item-1', quantity: 50 }],
        },
        'user-1',
      );

      expect(salesFulfilmentRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          organisationId: 'org-1',
          salesOrderId: 'order-1',
          locationId: 'location-1',
          idempotencyKey: 'key-1',
          items: [{ salesOrderItemId: 'item-1', productId: 'product-1', quantity: 50 }],
        }),
      );
      expect(result.order.status).toBe(SalesOrderStatus.PARTIALLY_FULFILLED);
    });

    it('translates a repository InsufficientStockError into a BadRequestException', async () => {
      const { service, salesOrderRepository, inventoryStockRepository, salesFulfilmentRepository } =
        makeService();
      salesOrderRepository.findById.mockResolvedValue(confirmedOrder);
      inventoryStockRepository.findManyByProductsAndLocation.mockResolvedValue([
        { productId: 'product-1', quantityOnHand: 72 } as unknown as InventoryStockWithProduct,
      ]);
      salesFulfilmentRepository.create.mockRejectedValue(new InsufficientStockError('short'));

      await expect(
        service.fulfil(
          'org-1',
          'order-1',
          {
            locationId: 'location-1',
            fulfilmentDate: new Date(),
            items: [{ salesOrderItemId: 'item-1', quantity: 50 }],
          },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('translates a repository SalesFulfilmentConflictError into a BadRequestException', async () => {
      const { service, salesOrderRepository, inventoryStockRepository, salesFulfilmentRepository } =
        makeService();
      salesOrderRepository.findById.mockResolvedValue(confirmedOrder);
      inventoryStockRepository.findManyByProductsAndLocation.mockResolvedValue([
        { productId: 'product-1', quantityOnHand: 72 } as unknown as InventoryStockWithProduct,
      ]);
      salesFulfilmentRepository.create.mockRejectedValue(
        new SalesFulfilmentConflictError('conflict'),
      );

      await expect(
        service.fulfil(
          'org-1',
          'order-1',
          {
            locationId: 'location-1',
            fulfilmentDate: new Date(),
            items: [{ salesOrderItemId: 'item-1', quantity: 50 }],
          },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('listFulfilments', () => {
    it('delegates to the repository', async () => {
      const { service, salesFulfilmentRepository } = makeService();
      salesFulfilmentRepository.findManyBySalesOrder.mockResolvedValue([]);

      await service.listFulfilments('org-1', 'order-1');

      expect(salesFulfilmentRepository.findManyBySalesOrder).toHaveBeenCalledWith(
        'org-1',
        'order-1',
      );
    });
  });
});
