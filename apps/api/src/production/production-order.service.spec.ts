import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  BillOfMaterialStatus,
  LocationStatus,
  ProductionOrderStatus,
  ProductionRejectionReason,
  ProductType,
} from '@prisma/client';

import { InventoryLocationRepository } from '../inventory/inventory-location.repository';
import {
  InventoryStockRepository,
  InventoryStockWithProduct,
} from '../inventory/inventory-stock.repository';
import {
  BillOfMaterialRepository,
  BillOfMaterialWithRelations,
} from './bill-of-material.repository';
import {
  InsufficientStockError,
  ProductionMaterialIssueConflictError,
  ProductionMaterialIssueRepository,
  ProductionMaterialIssueWithItems,
} from './production-material-issue.repository';
import {
  ProductionOrderRepository,
  ProductionOrderWithRelations,
} from './production-order.repository';
import { ProductionOrderService } from './production-order.service';
import {
  ProductionCompletionConflictError,
  ProductionRunRepository,
} from './production-run.repository';

describe('ProductionOrderService', () => {
  const activeBom: BillOfMaterialWithRelations = {
    id: 'bom-1',
    organisationId: 'org-1',
    bomNumber: 'BOM-000001',
    productId: 'product-finished',
    name: 'Plantain Chips v1',
    status: BillOfMaterialStatus.ACTIVE,
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

  const location = {
    id: 'location-1',
    organisationId: 'org-1',
    name: 'Main Warehouse',
    status: LocationStatus.ACTIVE,
    isDefault: true,
    createdById: 'user-1',
    updatedById: 'user-1',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  const order: ProductionOrderWithRelations = {
    id: 'order-1',
    organisationId: 'org-1',
    productionOrderNumber: 'PROD-000001',
    productId: 'product-finished',
    billOfMaterialId: 'bom-1',
    plannedQuantity: 500,
    locationId: 'location-1',
    status: ProductionOrderStatus.DRAFT,
    notes: null,
    createdById: 'user-1',
    updatedById: 'user-1',
    createdAt: new Date('2026-08-01'),
    updatedAt: new Date('2026-08-01'),
    product: { id: 'product-finished', code: 'PRD-000001', name: 'Plantain Chips', unit: 'Pack' },
    billOfMaterial: { id: 'bom-1', bomNumber: 'BOM-000001' },
    location: { id: 'location-1', name: 'Main Warehouse' },
    items: [
      {
        id: 'poi-1',
        componentProductId: 'product-raw',
        requiredQuantity: 250,
        unitOfMeasure: 'Kilogram',
        componentProduct: {
          id: 'product-raw',
          code: 'PRD-000002',
          name: 'Plantain',
          unit: 'Kilogram',
        },
      },
    ],
    productionRun: null,
  };

  function makeService() {
    const productionOrderRepository = {
      create: jest.fn(),
      findById: jest.fn(),
      findManyByOrganisation: jest.fn(),
      existsByNumber: jest.fn().mockResolvedValue(false),
      update: jest.fn(),
      updateStatus: jest.fn(),
    } as unknown as jest.Mocked<ProductionOrderRepository>;
    const productionMaterialIssueRepository = {
      issue: jest.fn(),
      getIssuedTotals: jest.fn().mockResolvedValue(new Map()),
      findManyByProductionOrder: jest.fn(),
      getTotalWipValue: jest.fn().mockResolvedValue(0),
      findJournalEntriesByProductionOrder: jest.fn().mockResolvedValue([]),
      findByIdempotencyKey: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<ProductionMaterialIssueRepository>;
    const productionRunRepository = {
      complete: jest.fn(),
      findByProductionOrder: jest.fn(),
      findJournalEntryForOrder: jest.fn().mockResolvedValue(null),
      findByIdempotencyKey: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<ProductionRunRepository>;
    const billOfMaterialRepository = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<BillOfMaterialRepository>;
    const inventoryStockRepository = {
      findManyByProductsAndLocation: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<InventoryStockRepository>;
    const inventoryLocationRepository = {
      findById: jest.fn().mockResolvedValue(location),
    } as unknown as jest.Mocked<InventoryLocationRepository>;

    const service = new ProductionOrderService(
      productionOrderRepository,
      productionMaterialIssueRepository,
      productionRunRepository,
      billOfMaterialRepository,
      inventoryStockRepository,
      inventoryLocationRepository,
    );
    return {
      service,
      productionOrderRepository,
      productionMaterialIssueRepository,
      productionRunRepository,
      billOfMaterialRepository,
      inventoryStockRepository,
      inventoryLocationRepository,
    };
  }

  describe('create', () => {
    it('scales bom item quantities against plannedQuantity/yieldQuantity into a requirement snapshot', async () => {
      const { service, billOfMaterialRepository, productionOrderRepository } = makeService();
      billOfMaterialRepository.findById.mockResolvedValue(activeBom);
      productionOrderRepository.create.mockResolvedValue(order);

      await service.create(
        'org-1',
        { billOfMaterialId: 'bom-1', plannedQuantity: 500, locationId: 'location-1' },
        'user-1',
      );

      expect(productionOrderRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          productionOrderNumber: 'PROD-000001',
          status: ProductionOrderStatus.DRAFT,
          items: {
            create: [
              {
                componentProductId: 'product-raw',
                requiredQuantity: 250,
                unitOfMeasure: 'Kilogram',
              },
            ],
          },
        }),
      );
    });

    it('rejects a DRAFT bill of materials', async () => {
      const { service, billOfMaterialRepository } = makeService();
      billOfMaterialRepository.findById.mockResolvedValue({
        ...activeBom,
        status: BillOfMaterialStatus.DRAFT,
      });

      await expect(
        service.create(
          'org-1',
          { billOfMaterialId: 'bom-1', plannedQuantity: 500, locationId: 'location-1' },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when the bill of materials does not exist in this organisation', async () => {
      const { service, billOfMaterialRepository } = makeService();
      billOfMaterialRepository.findById.mockResolvedValue(null);

      await expect(
        service.create(
          'org-1',
          { billOfMaterialId: 'missing', plannedQuantity: 500, locationId: 'location-1' },
          'user-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects an inactive location', async () => {
      const { service, billOfMaterialRepository, inventoryLocationRepository } = makeService();
      billOfMaterialRepository.findById.mockResolvedValue(activeBom);
      inventoryLocationRepository.findById.mockResolvedValue({
        ...location,
        status: LocationStatus.INACTIVE,
      });

      await expect(
        service.create(
          'org-1',
          { billOfMaterialId: 'bom-1', plannedQuantity: 500, locationId: 'location-1' },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('update', () => {
    it('rejects editing a non-draft order', async () => {
      const { service, productionOrderRepository } = makeService();
      productionOrderRepository.findById.mockResolvedValue({
        ...order,
        status: ProductionOrderStatus.PLANNED,
      });

      await expect(service.update('org-1', 'order-1', { notes: 'x' }, 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it("recomputes the requirement snapshot from the order's own pinned bom when plannedQuantity changes", async () => {
      const { service, productionOrderRepository, billOfMaterialRepository } = makeService();
      productionOrderRepository.findById.mockResolvedValue(order);
      billOfMaterialRepository.findById.mockResolvedValue(activeBom);
      productionOrderRepository.update.mockResolvedValue(order);

      await service.update('org-1', 'order-1', { plannedQuantity: 1000 }, 'user-1');

      expect(productionOrderRepository.update).toHaveBeenCalledWith(
        'org-1',
        'order-1',
        expect.objectContaining({ plannedQuantity: 1000 }),
        [{ componentProductId: 'product-raw', requiredQuantity: 500, unitOfMeasure: 'Kilogram' }],
      );
    });

    it('does not recompute the snapshot when plannedQuantity is unchanged', async () => {
      const { service, productionOrderRepository, billOfMaterialRepository } = makeService();
      productionOrderRepository.findById.mockResolvedValue(order);
      productionOrderRepository.update.mockResolvedValue(order);

      await service.update('org-1', 'order-1', { notes: 'updated' }, 'user-1');

      expect(billOfMaterialRepository.findById).not.toHaveBeenCalled();
      expect(productionOrderRepository.update).toHaveBeenCalledWith(
        'org-1',
        'order-1',
        expect.objectContaining({ notes: 'updated' }),
        undefined,
      );
    });
  });

  describe('bom snapshot immutability', () => {
    it('does not recalculate requirements when the source bom later changes after order creation', async () => {
      const { service, billOfMaterialRepository, productionOrderRepository } = makeService();
      billOfMaterialRepository.findById.mockResolvedValue(activeBom);
      productionOrderRepository.create.mockResolvedValue(order);

      await service.create(
        'org-1',
        { billOfMaterialId: 'bom-1', plannedQuantity: 500, locationId: 'location-1' },
        'user-1',
      );
      const snapshotAtCreation = productionOrderRepository.create.mock.calls[0]![0];

      // The bom is edited after order creation (e.g. component quantity doubled).
      billOfMaterialRepository.findById.mockResolvedValue({
        ...activeBom,
        items: [{ ...activeBom.items[0]!, quantity: 1000 }],
      });

      // getById reads the order's own stored items, never recomputing from the (now-changed) bom.
      productionOrderRepository.findById.mockResolvedValue(order);
      const fetched = await service.getById('org-1', 'order-1');

      expect(
        (snapshotAtCreation as { items: { create: { requiredQuantity: number }[] } }).items
          .create[0]!.requiredQuantity,
      ).toBe(250);
      expect(fetched.items[0]!.requiredQuantity).toBe(250);
    });
  });

  describe('plan', () => {
    it('transitions DRAFT to PLANNED', async () => {
      const { service, productionOrderRepository } = makeService();
      productionOrderRepository.findById.mockResolvedValue(order);
      productionOrderRepository.updateStatus.mockResolvedValue({
        ...order,
        status: ProductionOrderStatus.PLANNED,
      });

      await service.plan('org-1', 'order-1', 'user-1');

      expect(productionOrderRepository.updateStatus).toHaveBeenCalledWith(
        'org-1',
        'order-1',
        [ProductionOrderStatus.DRAFT],
        ProductionOrderStatus.PLANNED,
        'user-1',
      );
    });

    it('rejects planning a non-draft order', async () => {
      const { service, productionOrderRepository } = makeService();
      productionOrderRepository.findById.mockResolvedValue({
        ...order,
        status: ProductionOrderStatus.PLANNED,
      });

      await expect(service.plan('org-1', 'order-1', 'user-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('cancel', () => {
    it('cancels a DRAFT order', async () => {
      const { service, productionOrderRepository } = makeService();
      productionOrderRepository.findById.mockResolvedValue(order);
      productionOrderRepository.updateStatus.mockResolvedValue({
        ...order,
        status: ProductionOrderStatus.CANCELLED,
      });

      await service.cancel('org-1', 'order-1', 'user-1');

      expect(productionOrderRepository.updateStatus).toHaveBeenCalledWith(
        'org-1',
        'order-1',
        [ProductionOrderStatus.DRAFT, ProductionOrderStatus.PLANNED],
        ProductionOrderStatus.CANCELLED,
        'user-1',
      );
    });

    it('cancels a PLANNED order', async () => {
      const { service, productionOrderRepository } = makeService();
      productionOrderRepository.findById.mockResolvedValue({
        ...order,
        status: ProductionOrderStatus.PLANNED,
      });
      productionOrderRepository.updateStatus.mockResolvedValue({
        ...order,
        status: ProductionOrderStatus.CANCELLED,
      });

      await service.cancel('org-1', 'order-1', 'user-1');
      expect(productionOrderRepository.updateStatus).toHaveBeenCalled();
    });

    it('blocks cancellation once material has been issued (IN_PROGRESS)', async () => {
      const { service, productionOrderRepository } = makeService();
      productionOrderRepository.findById.mockResolvedValue({
        ...order,
        status: ProductionOrderStatus.IN_PROGRESS,
      });

      await expect(service.cancel('org-1', 'order-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects cancelling an already-completed order', async () => {
      const { service, productionOrderRepository } = makeService();
      productionOrderRepository.findById.mockResolvedValue({
        ...order,
        status: ProductionOrderStatus.COMPLETED,
      });

      await expect(service.cancel('org-1', 'order-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects cancelling an already-cancelled order', async () => {
      const { service, productionOrderRepository } = makeService();
      productionOrderRepository.findById.mockResolvedValue({
        ...order,
        status: ProductionOrderStatus.CANCELLED,
      });

      await expect(service.cancel('org-1', 'order-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('getAvailability', () => {
    it('computes required/available/shortfall per component without gating anything', async () => {
      const { service, productionOrderRepository, inventoryStockRepository } = makeService();
      productionOrderRepository.findById.mockResolvedValue(order);
      inventoryStockRepository.findManyByProductsAndLocation.mockResolvedValue([
        {
          productId: 'product-raw',
          quantityOnHand: 100,
          quantityReserved: 20,
        } as unknown as InventoryStockWithProduct,
      ]);

      const rows = await service.getAvailability('org-1', 'order-1');

      expect(rows).toEqual([
        expect.objectContaining({
          componentProductId: 'product-raw',
          requiredQuantity: 250,
          availableQuantity: 80,
          shortfall: 170,
        }),
      ]);
    });

    it('treats a component with no stock row as zero available', async () => {
      const { service, productionOrderRepository, inventoryStockRepository } = makeService();
      productionOrderRepository.findById.mockResolvedValue(order);
      inventoryStockRepository.findManyByProductsAndLocation.mockResolvedValue([]);

      const rows = await service.getAvailability('org-1', 'order-1');

      expect(rows[0]).toEqual(expect.objectContaining({ availableQuantity: 0, shortfall: 250 }));
    });
  });

  describe('issueMaterial', () => {
    const plannedOrder = { ...order, status: ProductionOrderStatus.PLANNED };

    it('rejects issuing against a DRAFT order', async () => {
      const { service, productionOrderRepository } = makeService();
      productionOrderRepository.findById.mockResolvedValue(order);

      await expect(
        service.issueMaterial(
          'org-1',
          'order-1',
          { issuedDate: new Date(), items: [{ componentProductId: 'product-raw', quantity: 100 }] },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects issuing against a completed order', async () => {
      const { service, productionOrderRepository } = makeService();
      productionOrderRepository.findById.mockResolvedValue({
        ...order,
        status: ProductionOrderStatus.COMPLETED,
      });

      await expect(
        service.issueMaterial(
          'org-1',
          'order-1',
          { issuedDate: new Date(), items: [{ componentProductId: 'product-raw', quantity: 100 }] },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects issuing against a cancelled order', async () => {
      const { service, productionOrderRepository } = makeService();
      productionOrderRepository.findById.mockResolvedValue({
        ...order,
        status: ProductionOrderStatus.CANCELLED,
      });

      await expect(
        service.issueMaterial(
          'org-1',
          'order-1',
          { issuedDate: new Date(), items: [{ componentProductId: 'product-raw', quantity: 100 }] },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("rejects an item that is not part of this order's requirement snapshot", async () => {
      const { service, productionOrderRepository } = makeService();
      productionOrderRepository.findById.mockResolvedValue(plannedOrder);

      await expect(
        service.issueMaterial(
          'org-1',
          'order-1',
          {
            issuedDate: new Date(),
            items: [{ componentProductId: 'not-a-component', quantity: 10 }],
          },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an over-issue beyond the required quantity', async () => {
      const { service, productionOrderRepository, productionMaterialIssueRepository } =
        makeService();
      productionOrderRepository.findById.mockResolvedValue(plannedOrder);
      productionMaterialIssueRepository.getIssuedTotals.mockResolvedValue(new Map());

      await expect(
        service.issueMaterial(
          'org-1',
          'order-1',
          { issuedDate: new Date(), items: [{ componentProductId: 'product-raw', quantity: 300 }] },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(productionMaterialIssueRepository.issue).not.toHaveBeenCalled();
    });

    it('rejects an over-issue that only exceeds when combined with prior issues', async () => {
      const { service, productionOrderRepository, productionMaterialIssueRepository } =
        makeService();
      productionOrderRepository.findById.mockResolvedValue(plannedOrder);
      productionMaterialIssueRepository.getIssuedTotals.mockResolvedValue(
        new Map([['product-raw', 200]]),
      );

      await expect(
        service.issueMaterial(
          'org-1',
          'order-1',
          { issuedDate: new Date(), items: [{ componentProductId: 'product-raw', quantity: 100 }] },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects issuing more than the currently available stock', async () => {
      const {
        service,
        productionOrderRepository,
        productionMaterialIssueRepository,
        inventoryStockRepository,
      } = makeService();
      productionOrderRepository.findById.mockResolvedValue(plannedOrder);
      productionMaterialIssueRepository.getIssuedTotals.mockResolvedValue(new Map());
      inventoryStockRepository.findManyByProductsAndLocation.mockResolvedValue([
        {
          productId: 'product-raw',
          quantityOnHand: 50,
          quantityReserved: 0,
        } as unknown as InventoryStockWithProduct,
      ]);

      await expect(
        service.issueMaterial(
          'org-1',
          'order-1',
          { issuedDate: new Date(), items: [{ componentProductId: 'product-raw', quantity: 100 }] },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(productionMaterialIssueRepository.issue).not.toHaveBeenCalled();
    });

    it('allows a partial issue within the required quantity and delegates to the repository', async () => {
      const {
        service,
        productionOrderRepository,
        productionMaterialIssueRepository,
        inventoryStockRepository,
      } = makeService();
      productionOrderRepository.findById.mockResolvedValue(plannedOrder);
      productionMaterialIssueRepository.getIssuedTotals.mockResolvedValue(new Map());
      inventoryStockRepository.findManyByProductsAndLocation.mockResolvedValue([
        {
          productId: 'product-raw',
          quantityOnHand: 250,
          quantityReserved: 0,
        } as unknown as InventoryStockWithProduct,
      ]);
      const materialIssue = {
        id: 'issue-1',
        items: [],
      } as unknown as ProductionMaterialIssueWithItems;
      productionMaterialIssueRepository.issue.mockResolvedValue({
        materialIssue,
        transitionedToInProgress: true,
        journalEntry: null,
        wasCreated: true,
      });

      const result = await service.issueMaterial(
        'org-1',
        'order-1',
        {
          issuedDate: new Date('2026-08-05'),
          items: [{ componentProductId: 'product-raw', quantity: 100 }],
        },
        'user-1',
      );

      expect(productionMaterialIssueRepository.issue).toHaveBeenCalledWith(
        expect.objectContaining({
          organisationId: 'org-1',
          productionOrderId: 'order-1',
          locationId: 'location-1',
          items: [{ componentProductId: 'product-raw', quantity: 100 }],
        }),
      );
      expect(result.transitionedToInProgress).toBe(true);
    });

    it('short-circuits on a matching idempotency key even when the order has since moved past PLANNED and the requirement is already fully issued — a naive re-check would otherwise wrongly reject the retry as an over-issue', async () => {
      const { service, productionOrderRepository, productionMaterialIssueRepository } =
        makeService();
      // The order is now IN_PROGRESS (this call's own prior effect) and the
      // requirement is already fully issued (also this call's own prior effect) —
      // exactly the state a genuine retry arrives into.
      productionOrderRepository.findById.mockResolvedValue({
        ...plannedOrder,
        status: ProductionOrderStatus.IN_PROGRESS,
      });
      productionMaterialIssueRepository.getIssuedTotals.mockResolvedValue(
        new Map([['product-raw', 250]]),
      );
      const existingMaterialIssue = {
        id: 'issue-1',
        items: [],
      } as unknown as ProductionMaterialIssueWithItems;
      productionMaterialIssueRepository.findByIdempotencyKey.mockResolvedValue({
        materialIssue: existingMaterialIssue,
        journalEntry: null,
      });

      const result = await service.issueMaterial(
        'org-1',
        'order-1',
        {
          issuedDate: new Date('2026-08-05'),
          idempotencyKey: 'retry-key-1',
          items: [{ componentProductId: 'product-raw', quantity: 250 }],
        },
        'user-1',
      );

      expect(productionMaterialIssueRepository.findByIdempotencyKey).toHaveBeenCalledWith(
        'org-1',
        'order-1',
        'retry-key-1',
      );
      expect(result).toEqual({
        materialIssue: existingMaterialIssue,
        transitionedToInProgress: false,
        journalEntry: null,
        wasCreated: false,
      });
      expect(productionMaterialIssueRepository.issue).not.toHaveBeenCalled();
    });

    it('translates a repository InsufficientStockError into a BadRequestException', async () => {
      const {
        service,
        productionOrderRepository,
        productionMaterialIssueRepository,
        inventoryStockRepository,
      } = makeService();
      productionOrderRepository.findById.mockResolvedValue(plannedOrder);
      productionMaterialIssueRepository.getIssuedTotals.mockResolvedValue(new Map());
      inventoryStockRepository.findManyByProductsAndLocation.mockResolvedValue([
        {
          productId: 'product-raw',
          quantityOnHand: 250,
          quantityReserved: 0,
        } as unknown as InventoryStockWithProduct,
      ]);
      productionMaterialIssueRepository.issue.mockRejectedValue(
        new InsufficientStockError('short'),
      );

      await expect(
        service.issueMaterial(
          'org-1',
          'order-1',
          { issuedDate: new Date(), items: [{ componentProductId: 'product-raw', quantity: 100 }] },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('translates a repository ProductionMaterialIssueConflictError into a BadRequestException', async () => {
      const {
        service,
        productionOrderRepository,
        productionMaterialIssueRepository,
        inventoryStockRepository,
      } = makeService();
      productionOrderRepository.findById.mockResolvedValue(plannedOrder);
      productionMaterialIssueRepository.getIssuedTotals.mockResolvedValue(new Map());
      inventoryStockRepository.findManyByProductsAndLocation.mockResolvedValue([
        {
          productId: 'product-raw',
          quantityOnHand: 250,
          quantityReserved: 0,
        } as unknown as InventoryStockWithProduct,
      ]);
      productionMaterialIssueRepository.issue.mockRejectedValue(
        new ProductionMaterialIssueConflictError('conflict'),
      );

      await expect(
        service.issueMaterial(
          'org-1',
          'order-1',
          { issuedDate: new Date(), items: [{ componentProductId: 'product-raw', quantity: 100 }] },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('completeProduction', () => {
    it('computes acceptedQuantity server-side as produced minus rejected, ignoring any client value', async () => {
      const { service, productionOrderRepository, productionRunRepository } = makeService();
      const inProgressOrder = { ...order, status: ProductionOrderStatus.IN_PROGRESS };
      productionOrderRepository.findById
        .mockResolvedValueOnce(inProgressOrder)
        .mockResolvedValueOnce({ ...inProgressOrder, status: ProductionOrderStatus.COMPLETED });
      productionRunRepository.complete.mockResolvedValue({
        productionRun: {
          id: 'run-1',
          producedQuantity: 480,
          rejectedQuantity: 30,
          acceptedQuantity: 450,
        } as never,
        journalEntry: null,
        wasCreated: true,
      });

      const result = await service.completeProduction(
        'org-1',
        'order-1',
        {
          producedQuantity: 480,
          rejectedQuantity: 30,
          rejectionReason: ProductionRejectionReason.BURNT,
          rejectionNotes: 'edges burnt',
          // @ts-expect-error acceptedQuantity is never part of the accepted input type
          acceptedQuantity: 999,
        },
        'user-1',
      );

      expect(productionRunRepository.complete).toHaveBeenCalledWith(
        expect.objectContaining({
          producedQuantity: 480,
          rejectedQuantity: 30,
          acceptedQuantity: 450,
        }),
      );
      expect(result.productionRun.acceptedQuantity).toBe(450);
    });

    it('rejects completing an order that is not IN_PROGRESS', async () => {
      const { service, productionOrderRepository } = makeService();
      productionOrderRepository.findById.mockResolvedValue({
        ...order,
        status: ProductionOrderStatus.PLANNED,
      });

      await expect(
        service.completeProduction(
          'org-1',
          'order-1',
          { producedQuantity: 100, rejectedQuantity: 0 },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('short-circuits on a matching idempotency key even though the order has already moved to COMPLETED — a naive re-check would otherwise wrongly reject the retry as "not IN_PROGRESS"', async () => {
      const { service, productionOrderRepository, productionRunRepository } = makeService();
      // The order is now COMPLETED (this call's own prior effect) — exactly the
      // state a genuine retry arrives into.
      const completedOrder = { ...order, status: ProductionOrderStatus.COMPLETED };
      productionOrderRepository.findById.mockResolvedValue(completedOrder);
      const existingRun = {
        id: 'run-1',
        producedQuantity: 480,
        rejectedQuantity: 30,
        acceptedQuantity: 450,
        idempotencyKey: 'retry-key-1',
      } as never;
      productionRunRepository.findByIdempotencyKey.mockResolvedValue({
        productionRun: existingRun,
        journalEntry: null,
      });

      const result = await service.completeProduction(
        'org-1',
        'order-1',
        { producedQuantity: 480, rejectedQuantity: 30, idempotencyKey: 'retry-key-1' },
        'user-1',
      );

      expect(productionRunRepository.findByIdempotencyKey).toHaveBeenCalledWith(
        'org-1',
        'order-1',
        'retry-key-1',
      );
      expect(result).toEqual({
        productionOrder: completedOrder,
        productionRun: existingRun,
        journalEntry: null,
        wasCreated: false,
      });
      expect(productionRunRepository.complete).not.toHaveBeenCalled();
    });

    it('writes no inventory movement when everything produced is rejected (zero accepted)', async () => {
      const { service, productionOrderRepository, productionRunRepository } = makeService();
      const inProgressOrder = { ...order, status: ProductionOrderStatus.IN_PROGRESS };
      productionOrderRepository.findById
        .mockResolvedValueOnce(inProgressOrder)
        .mockResolvedValueOnce({ ...inProgressOrder, status: ProductionOrderStatus.COMPLETED });
      productionRunRepository.complete.mockResolvedValue({
        productionRun: {
          id: 'run-1',
          producedQuantity: 50,
          rejectedQuantity: 50,
          acceptedQuantity: 0,
        } as never,
        journalEntry: null,
        wasCreated: true,
      });

      await service.completeProduction(
        'org-1',
        'order-1',
        {
          producedQuantity: 50,
          rejectedQuantity: 50,
          rejectionReason: ProductionRejectionReason.BURNT,
        },
        'user-1',
      );

      expect(productionRunRepository.complete).toHaveBeenCalledWith(
        expect.objectContaining({ acceptedQuantity: 0 }),
      );
    });

    it('translates a repository ProductionCompletionConflictError into a BadRequestException', async () => {
      const { service, productionOrderRepository, productionRunRepository } = makeService();
      productionOrderRepository.findById.mockResolvedValue({
        ...order,
        status: ProductionOrderStatus.IN_PROGRESS,
      });
      productionRunRepository.complete.mockRejectedValue(
        new ProductionCompletionConflictError('conflict'),
      );

      await expect(
        service.completeProduction(
          'org-1',
          'order-1',
          { producedQuantity: 100, rejectedQuantity: 0 },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('tenant isolation', () => {
    it('getById throws NotFoundException for an order belonging to another organisation', async () => {
      const { service, productionOrderRepository } = makeService();
      productionOrderRepository.findById.mockResolvedValue(null);

      await expect(service.getById('org-2', 'order-1')).rejects.toThrow(NotFoundException);
      expect(productionOrderRepository.findById).toHaveBeenCalledWith('org-2', 'order-1');
    });
  });
});
