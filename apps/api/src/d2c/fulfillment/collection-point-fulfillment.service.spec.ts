import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { CollectionPointFulfillmentStatus } from '@prisma/client';

import { AuditService } from '../../identity/audit/audit.service';
import { EffectiveAccessResolver } from '../../identity/authorization/effective-access-resolver';
import { OutletRepository } from '../../retail/outlet/outlet.repository';
import { SalesFulfilmentService } from '../../sales/sales-fulfilment.service';
import { SalesOrderRepository } from '../../sales/sales-order.repository';
import { ConsumerService } from '../consumer/consumer.service';
import { CollectionPointFulfillmentRepository } from './collection-point-fulfillment.repository';
import { CollectionPointFulfillmentService } from './collection-point-fulfillment.service';
import {
  AlreadyAssignedError,
  CollectionPointNotEligibleError,
  InvalidFulfillmentTransitionError,
  NoEligibleCollectionPointError,
  NotAuthorizedForCollectionPointError,
} from './collection-point-fulfillment.types';

describe('CollectionPointFulfillmentService', () => {
  const orgId = 'org-1';

  const eligibleOutlet = {
    id: 'outlet-1',
    organisationId: orgId,
    name: 'Bodija Supermart',
    status: 'ACTIVE',
    collectionPointStatus: 'ENABLED',
    territoryId: 'territory-1',
    inventoryLocationId: 'location-1',
    collectionPointResponsibleUserId: 'rep-1',
    createdAt: new Date('2026-01-01'),
  };

  const consumer = { id: 'consumer-1', organisationId: orgId, territoryId: 'territory-1' };

  const order = {
    id: 'so-1',
    organisationId: orgId,
    orderCode: 'SO-000001',
    consumerId: 'consumer-1',
    status: 'CONFIRMED',
    items: [{ id: 'item-1', productId: 'product-1', quantity: 2, quantityFulfilled: 0 }],
  };

  const cpf = {
    id: 'cpf-1',
    organisationId: orgId,
    salesOrderId: 'so-1',
    outletId: 'outlet-1',
    status: CollectionPointFulfillmentStatus.ASSIGNED,
    assignedAt: new Date(),
    preparingAt: null,
    readyAt: null,
    collectedAt: null,
    collectedById: null,
    outlet: {
      id: 'outlet-1',
      name: 'Bodija Supermart',
      collectionPointResponsibleUserId: 'rep-1',
    },
    salesOrder: {
      id: 'so-1',
      orderCode: 'SO-000001',
      status: 'CONFIRMED',
      consumerId: 'consumer-1',
      orderDate: new Date('2026-01-01'),
      total: 3000,
      consumer: { id: 'consumer-1', fullName: 'Ada Okafor', phoneNumber: '+2348012345678' },
      items: [
        { id: 'item-1', quantity: 2, product: { id: 'product-1', name: 'Snack', unit: 'pack' } },
      ],
    },
  };

  function makeService() {
    const repository = {
      create: jest.fn(),
      findById: jest.fn(),
      findBySalesOrderId: jest.fn(),
      findManyByOutlet: jest.fn(),
      updateStatus: jest.fn(),
    } as unknown as jest.Mocked<CollectionPointFulfillmentRepository>;
    const outletRepository = {
      findById: jest.fn(),
      findManyByOrganisation: jest.fn(),
    } as unknown as jest.Mocked<OutletRepository>;
    const salesOrderRepository = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<SalesOrderRepository>;
    const salesFulfilmentService = {
      getAvailability: jest.fn(),
      fulfil: jest.fn(),
    } as unknown as jest.Mocked<SalesFulfilmentService>;
    const consumerService = {
      getById: jest.fn(),
    } as unknown as jest.Mocked<ConsumerService>;
    const auditService = { record: jest.fn() } as unknown as jest.Mocked<AuditService>;
    const effectiveAccessResolver = {
      resolve: jest.fn().mockResolvedValue({ isOwnerBypass: false, grants: new Map() }),
    } as unknown as jest.Mocked<EffectiveAccessResolver>;

    const service = new CollectionPointFulfillmentService(
      repository,
      outletRepository,
      salesOrderRepository,
      salesFulfilmentService,
      consumerService,
      auditService,
      effectiveAccessResolver,
    );
    return {
      service,
      repository,
      outletRepository,
      salesOrderRepository,
      salesFulfilmentService,
      consumerService,
      auditService,
      effectiveAccessResolver,
    };
  }

  describe('autoAssign', () => {
    it('creates a CollectionPointFulfillment for a matching territory outlet', async () => {
      const {
        service,
        repository,
        salesOrderRepository,
        consumerService,
        outletRepository,
        auditService,
      } = makeService();
      repository.findBySalesOrderId.mockResolvedValue(null);
      salesOrderRepository.findById.mockResolvedValue(order as never);
      consumerService.getById.mockResolvedValue(consumer as never);
      outletRepository.findManyByOrganisation.mockResolvedValue([eligibleOutlet] as never);
      repository.create.mockResolvedValue(cpf as never);

      await service.autoAssign(orgId, 'so-1');

      expect(repository.create).toHaveBeenCalled();
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'collection_point_fulfillment.assigned' }),
      );
    });

    it('is a safe no-op when already assigned (duplicate payment-success callback)', async () => {
      const { service, repository } = makeService();
      repository.findBySalesOrderId.mockResolvedValue(cpf as never);

      await service.autoAssign(orgId, 'so-1');

      expect(repository.create).not.toHaveBeenCalled();
    });

    it('records an audit no-op and never throws when the consumer has no territory', async () => {
      const { service, repository, salesOrderRepository, consumerService, auditService } =
        makeService();
      repository.findBySalesOrderId.mockResolvedValue(null);
      salesOrderRepository.findById.mockResolvedValue(order as never);
      consumerService.getById.mockResolvedValue({ ...consumer, territoryId: null } as never);

      await expect(service.autoAssign(orgId, 'so-1')).resolves.toBeUndefined();
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'collection_point_fulfillment.assignment_failed' }),
      );
    });

    it('records an audit no-op and never throws when no eligible outlet exists in the territory', async () => {
      const {
        service,
        repository,
        salesOrderRepository,
        consumerService,
        outletRepository,
        auditService,
      } = makeService();
      repository.findBySalesOrderId.mockResolvedValue(null);
      salesOrderRepository.findById.mockResolvedValue(order as never);
      consumerService.getById.mockResolvedValue(consumer as never);
      outletRepository.findManyByOrganisation.mockResolvedValue([]);

      await expect(service.autoAssign(orgId, 'so-1')).resolves.toBeUndefined();
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'collection_point_fulfillment.assignment_failed' }),
      );
    });

    it('excludes an eligible-looking outlet with no inventoryLocationId', async () => {
      const { service, repository, salesOrderRepository, consumerService, outletRepository } =
        makeService();
      repository.findBySalesOrderId.mockResolvedValue(null);
      salesOrderRepository.findById.mockResolvedValue(order as never);
      consumerService.getById.mockResolvedValue(consumer as never);
      outletRepository.findManyByOrganisation.mockResolvedValue([
        { ...eligibleOutlet, inventoryLocationId: null },
      ] as never);

      await service.autoAssign(orgId, 'so-1');

      expect(repository.create).not.toHaveBeenCalled();
    });

    it('picks the earliest-created outlet deterministically when multiple are eligible', async () => {
      const { service, repository, salesOrderRepository, consumerService, outletRepository } =
        makeService();
      repository.findBySalesOrderId.mockResolvedValue(null);
      salesOrderRepository.findById.mockResolvedValue(order as never);
      consumerService.getById.mockResolvedValue(consumer as never);
      const newer = { ...eligibleOutlet, id: 'outlet-2', createdAt: new Date('2026-02-01') };
      outletRepository.findManyByOrganisation.mockResolvedValue([newer, eligibleOutlet] as never);
      repository.create.mockResolvedValue(cpf as never);

      await service.autoAssign(orgId, 'so-1');

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ outlet: { connect: { id: 'outlet-1' } } }),
      );
    });
  });

  describe('assignManually', () => {
    it('rejects an order that is already assigned', async () => {
      const { service, repository } = makeService();
      repository.findBySalesOrderId.mockResolvedValue(cpf as never);

      await expect(service.assignManually(orgId, 'so-1', undefined, 'admin-1')).rejects.toThrow(
        AlreadyAssignedError,
      );
    });

    it('rejects a specific ineligible outlet', async () => {
      const { service, repository, salesOrderRepository, outletRepository } = makeService();
      repository.findBySalesOrderId.mockResolvedValue(null);
      salesOrderRepository.findById.mockResolvedValue(order as never);
      outletRepository.findById.mockResolvedValue({
        ...eligibleOutlet,
        status: 'INACTIVE',
      } as never);

      await expect(service.assignManually(orgId, 'so-1', 'outlet-1', 'admin-1')).rejects.toThrow(
        CollectionPointNotEligibleError,
      );
    });

    it('rejects a B2B order (no consumerId)', async () => {
      const { service, repository, salesOrderRepository } = makeService();
      repository.findBySalesOrderId.mockResolvedValue(null);
      salesOrderRepository.findById.mockResolvedValue({ ...order, consumerId: null } as never);

      await expect(service.assignManually(orgId, 'so-1', undefined, 'admin-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws NoEligibleCollectionPointError when auto-selection (no outletId) finds nothing', async () => {
      const { service, repository, salesOrderRepository, consumerService, outletRepository } =
        makeService();
      repository.findBySalesOrderId.mockResolvedValue(null);
      salesOrderRepository.findById.mockResolvedValue(order as never);
      consumerService.getById.mockResolvedValue(consumer as never);
      outletRepository.findManyByOrganisation.mockResolvedValue([]);

      await expect(service.assignManually(orgId, 'so-1', undefined, 'admin-1')).rejects.toThrow(
        NoEligibleCollectionPointError,
      );
    });
  });

  describe('state transitions — strictly sequential, no arbitrary edits', () => {
    it('startPreparing: ASSIGNED -> PREPARING when authorized', async () => {
      const { service, repository, auditService } = makeService();
      repository.findById.mockResolvedValue(cpf as never);
      repository.updateStatus.mockResolvedValue({
        ...cpf,
        status: CollectionPointFulfillmentStatus.PREPARING,
      } as never);

      const result = await service.startPreparing(orgId, 'cpf-1', 'rep-1');

      expect(result.status).toBe('PREPARING');
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'collection_point_fulfillment.preparing_started' }),
      );
    });

    it('startPreparing: rejects a caller who is neither the assigned rep nor an admin', async () => {
      const { service, repository } = makeService();
      repository.findById.mockResolvedValue(cpf as never);

      await expect(service.startPreparing(orgId, 'cpf-1', 'stranger')).rejects.toThrow(
        NotAuthorizedForCollectionPointError,
      );
    });

    it('startPreparing: an admin (sales.customer.manage) may operate any Collection Point', async () => {
      const { service, repository, effectiveAccessResolver } = makeService();
      repository.findById.mockResolvedValue(cpf as never);
      effectiveAccessResolver.resolve.mockResolvedValue({
        isOwnerBypass: false,
        grants: new Map([['sales.customer.manage', {}]]),
      } as never);
      repository.updateStatus.mockResolvedValue({
        ...cpf,
        status: CollectionPointFulfillmentStatus.PREPARING,
      } as never);

      await expect(service.startPreparing(orgId, 'cpf-1', 'admin-1')).resolves.toBeDefined();
    });

    it('startPreparing: rejects an out-of-order transition (already PREPARING)', async () => {
      const { service, repository } = makeService();
      repository.findById.mockResolvedValue({
        ...cpf,
        status: CollectionPointFulfillmentStatus.PREPARING,
      } as never);
      repository.updateStatus.mockResolvedValue(null);

      await expect(service.startPreparing(orgId, 'cpf-1', 'rep-1')).rejects.toThrow(
        InvalidFulfillmentTransitionError,
      );
    });

    it('markReadyForCollection: rejects insufficient stock without transitioning', async () => {
      const { service, repository, outletRepository, salesFulfilmentService } = makeService();
      const preparing = { ...cpf, status: CollectionPointFulfillmentStatus.PREPARING };
      repository.findById.mockResolvedValue(preparing as never);
      outletRepository.findById.mockResolvedValue(eligibleOutlet as never);
      salesFulfilmentService.getAvailability.mockResolvedValue([
        {
          salesOrderItemId: 'item-1',
          productId: 'product-1',
          product: { id: 'product-1', code: 'PRD-1', name: 'Snack', unit: 'pack' },
          ordered: 2,
          fulfilled: 0,
          remaining: 2,
          availableStock: 1,
          shortfall: 1,
        },
      ]);

      await expect(service.markReadyForCollection(orgId, 'cpf-1', 'rep-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(repository.updateStatus).not.toHaveBeenCalled();
    });

    it('markReadyForCollection: rejects when the outlet has no inventory location configured', async () => {
      const { service, repository, outletRepository } = makeService();
      const preparing = { ...cpf, status: CollectionPointFulfillmentStatus.PREPARING };
      repository.findById.mockResolvedValue(preparing as never);
      outletRepository.findById.mockResolvedValue({
        ...eligibleOutlet,
        inventoryLocationId: null,
      } as never);

      await expect(service.markReadyForCollection(orgId, 'cpf-1', 'rep-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('markReadyForCollection: succeeds with sufficient stock', async () => {
      const { service, repository, outletRepository, salesFulfilmentService } = makeService();
      const preparing = { ...cpf, status: CollectionPointFulfillmentStatus.PREPARING };
      repository.findById.mockResolvedValue(preparing as never);
      outletRepository.findById.mockResolvedValue(eligibleOutlet as never);
      salesFulfilmentService.getAvailability.mockResolvedValue([
        {
          salesOrderItemId: 'item-1',
          productId: 'product-1',
          product: { id: 'product-1', code: 'PRD-1', name: 'Snack', unit: 'pack' },
          ordered: 2,
          fulfilled: 0,
          remaining: 2,
          availableStock: 5,
          shortfall: 0,
        },
      ]);
      repository.updateStatus.mockResolvedValue({
        ...preparing,
        status: CollectionPointFulfillmentStatus.READY_FOR_COLLECTION,
      } as never);

      const result = await service.markReadyForCollection(orgId, 'cpf-1', 'rep-1');
      expect(result.status).toBe('READY_FOR_COLLECTION');
    });
  });

  describe('confirmCollection — the inventory-deducting transition', () => {
    const ready = { ...cpf, status: CollectionPointFulfillmentStatus.READY_FOR_COLLECTION };

    it('calls the EXISTING SalesFulfilmentService.fulfil() with a deterministic idempotencyKey', async () => {
      const {
        service,
        repository,
        outletRepository,
        salesOrderRepository,
        salesFulfilmentService,
      } = makeService();
      repository.findById.mockResolvedValue(ready as never);
      repository.updateStatus.mockResolvedValue({
        ...ready,
        status: CollectionPointFulfillmentStatus.COLLECTED,
      } as never);
      outletRepository.findById.mockResolvedValue(eligibleOutlet as never);
      salesOrderRepository.findById.mockResolvedValue(order as never);

      const result = await service.confirmCollection(orgId, 'cpf-1', 'rep-1');

      expect(salesFulfilmentService.fulfil).toHaveBeenCalledWith(
        orgId,
        'so-1',
        expect.objectContaining({
          locationId: 'location-1',
          idempotencyKey: 'collection-point-fulfillment:cpf-1',
          items: [{ salesOrderItemId: 'item-1', quantity: 2 }],
        }),
        'rep-1',
      );
      expect(result.status).toBe('COLLECTED');
    });

    it('reverts to READY_FOR_COLLECTION (never stranding the record at COLLECTED) when fulfil() fails', async () => {
      // Found via live verification (docs/sprint-37-completion-report.md) — the dev
      // database's accounting periods didn't cover "today," so `fulfil()` threw
      // `NoOpenPeriodError`. Before this rollback existed, the CPF status had already
      // been flipped to COLLECTED, permanently stranding the record: the SalesOrder was
      // never actually fulfilled, stock was never deducted, and every retry short-
      // circuited as an idempotent no-op because the status already read COLLECTED.
      const {
        service,
        repository,
        outletRepository,
        salesOrderRepository,
        salesFulfilmentService,
      } = makeService();
      repository.findById.mockResolvedValue(ready as never);
      repository.updateStatus.mockResolvedValueOnce({
        ...ready,
        status: CollectionPointFulfillmentStatus.COLLECTED,
      } as never);
      repository.updateStatus.mockResolvedValueOnce({
        ...ready,
        status: CollectionPointFulfillmentStatus.READY_FOR_COLLECTION,
      } as never);
      outletRepository.findById.mockResolvedValue(eligibleOutlet as never);
      salesOrderRepository.findById.mockResolvedValue(order as never);
      salesFulfilmentService.fulfil.mockRejectedValue(
        new BadRequestException('No open accounting period covers 2026-09-30'),
      );

      await expect(service.confirmCollection(orgId, 'cpf-1', 'rep-1')).rejects.toThrow(
        'No open accounting period covers 2026-09-30',
      );

      expect(repository.updateStatus).toHaveBeenNthCalledWith(
        2,
        orgId,
        'cpf-1',
        [CollectionPointFulfillmentStatus.COLLECTED],
        expect.objectContaining({
          status: CollectionPointFulfillmentStatus.READY_FOR_COLLECTION,
          collectedAt: null,
          collectedById: null,
        }),
      );
    });

    it('rejects confirming collection on an order not yet READY_FOR_COLLECTION', async () => {
      const { service, repository, salesFulfilmentService } = makeService();
      repository.findById.mockResolvedValue(cpf as never); // still ASSIGNED
      repository.updateStatus.mockResolvedValue(null);

      await expect(service.confirmCollection(orgId, 'cpf-1', 'rep-1')).rejects.toThrow(
        InvalidFulfillmentTransitionError,
      );
      expect(salesFulfilmentService.fulfil).not.toHaveBeenCalled();
    });

    it('is idempotent: a duplicate confirm on an already-COLLECTED order never re-deducts stock', async () => {
      const { service, repository, salesFulfilmentService } = makeService();
      const collected = { ...ready, status: CollectionPointFulfillmentStatus.COLLECTED };
      repository.findById.mockResolvedValue(collected as never);
      repository.updateStatus.mockResolvedValue(null); // no rows matched — already COLLECTED

      const result = await service.confirmCollection(orgId, 'cpf-1', 'rep-1');

      expect(result.status).toBe('COLLECTED');
      expect(salesFulfilmentService.fulfil).not.toHaveBeenCalled();
    });

    it('rejects an unauthorized caller before ever touching inventory', async () => {
      const { service, repository, salesFulfilmentService } = makeService();
      repository.findById.mockResolvedValue(ready as never);

      await expect(service.confirmCollection(orgId, 'cpf-1', 'stranger')).rejects.toThrow(
        NotAuthorizedForCollectionPointError,
      );
      expect(repository.updateStatus).not.toHaveBeenCalled();
      expect(salesFulfilmentService.fulfil).not.toHaveBeenCalled();
    });

    it('5 genuinely concurrent confirmCollection calls result in exactly one fulfil() call', async () => {
      const {
        service,
        repository,
        outletRepository,
        salesOrderRepository,
        salesFulfilmentService,
      } = makeService();
      outletRepository.findById.mockResolvedValue(eligibleOutlet as never);
      salesOrderRepository.findById.mockResolvedValue(order as never);

      // Simulate the repository's own conditional-updateMany concurrency guarantee:
      // only the FIRST call actually matches (mirrors real Postgres row-level locking
      // serializing concurrent UPDATEs to the same row — see
      // docs/domains/d2c.md "Idempotency & Concurrency"). `findById` reflects the SAME
      // shared mutable state, so a losing call's re-fetch (after `updateStatus` returns
      // null) correctly observes COLLECTED, not a stale pre-race snapshot.
      let alreadyCollected = false;
      repository.findById.mockImplementation(() =>
        Promise.resolve({
          ...ready,
          status: alreadyCollected
            ? CollectionPointFulfillmentStatus.COLLECTED
            : CollectionPointFulfillmentStatus.READY_FOR_COLLECTION,
        } as never),
      );
      repository.updateStatus.mockImplementation(() => {
        if (alreadyCollected) {
          return Promise.resolve(null);
        }
        alreadyCollected = true;
        return Promise.resolve({
          ...ready,
          status: CollectionPointFulfillmentStatus.COLLECTED,
        } as never);
      });

      await Promise.all(
        Array.from({ length: 5 }, () => service.confirmCollection(orgId, 'cpf-1', 'rep-1')),
      );

      expect(salesFulfilmentService.fulfil).toHaveBeenCalledTimes(1);
    });
  });

  describe('getMyOutlets', () => {
    it('returns only outlets where the caller is the assigned representative', async () => {
      const { service, outletRepository, effectiveAccessResolver } = makeService();
      const other = {
        ...eligibleOutlet,
        id: 'outlet-2',
        collectionPointResponsibleUserId: 'someone-else',
      };
      outletRepository.findManyByOrganisation.mockResolvedValue([eligibleOutlet, other] as never);
      effectiveAccessResolver.resolve.mockResolvedValue({
        isOwnerBypass: false,
        grants: new Map(),
      } as never);

      const result = await service.getMyOutlets(orgId, 'rep-1');
      expect(result).toEqual([{ id: 'outlet-1', name: 'Bodija Supermart' }]);
    });

    it('returns every enabled Collection Point for an admin', async () => {
      const { service, outletRepository, effectiveAccessResolver } = makeService();
      const other = {
        ...eligibleOutlet,
        id: 'outlet-2',
        collectionPointResponsibleUserId: 'someone-else',
      };
      outletRepository.findManyByOrganisation.mockResolvedValue([eligibleOutlet, other] as never);
      effectiveAccessResolver.resolve.mockResolvedValue({
        isOwnerBypass: false,
        grants: new Map([['sales.customer.manage', {}]]),
      } as never);

      const result = await service.getMyOutlets(orgId, 'admin-1');
      expect(result).toHaveLength(2);
    });
  });

  describe('getQueueForOutlet — resource-ownership enforcement', () => {
    it('returns the queue for the assigned representative', async () => {
      const { service, outletRepository, repository } = makeService();
      outletRepository.findById.mockResolvedValue(eligibleOutlet as never);
      repository.findManyByOutlet.mockResolvedValue([cpf] as never);

      const result = await service.getQueueForOutlet(orgId, 'outlet-1', 'rep-1');
      expect(result).toHaveLength(1);
    });

    it('rejects a caller who is neither the assigned rep nor an admin', async () => {
      const { service, outletRepository } = makeService();
      outletRepository.findById.mockResolvedValue(eligibleOutlet as never);

      await expect(service.getQueueForOutlet(orgId, 'outlet-1', 'stranger')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('rejects a cross-tenant outlet id with NotFoundException', async () => {
      const { service, outletRepository } = makeService();
      outletRepository.findById.mockResolvedValue(null);

      await expect(service.getQueueForOutlet(orgId, 'outlet-1', 'rep-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
