import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { CollectionPointFulfillmentStatus } from '@prisma/client';

import { AuditService } from '../../identity/audit/audit.service';
import { EffectiveAccessResolver } from '../../identity/authorization/effective-access-resolver';
import { OrganisationService } from '../../identity/organisation/organisation.service';
import { InventoryStockRepository } from '../../inventory/inventory-stock.repository';
import { OutletRepository } from '../../retail/outlet/outlet.repository';
import { SalesFulfilmentService } from '../../sales/sales-fulfilment.service';
import { SalesOrderRepository } from '../../sales/sales-order.repository';
import { ConsumerService } from '../consumer/consumer.service';
import { ConsumerNotificationPort } from '../messaging/consumer-notification.port';
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
      consumer: {
        id: 'consumer-1',
        fullName: 'Ada Okafor',
        phoneNumber: '+2348012345678',
        territoryId: 'territory-1',
        territory: { name: 'Bodija' },
      },
      items: [
        { id: 'item-1', quantity: 2, product: { id: 'product-1', name: 'Snack', unit: 'pack' } },
      ],
      payments: [{ status: 'RECORDED', paymentDate: new Date('2026-01-01') }],
    },
  };

  function makeService() {
    const repository = {
      create: jest.fn(),
      findById: jest.fn(),
      findBySalesOrderId: jest.fn(),
      findManyByOutlet: jest.fn(),
      updateStatus: jest.fn(),
      findManyPaginated: jest.fn(),
      reassignOutlet: jest.fn(),
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
    const inventoryStockRepository = {
      findManyByProductsAndLocation: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<InventoryStockRepository>;
    const organisationService = {
      getById: jest.fn().mockResolvedValue({ id: orgId, displayName: null, name: 'Boby Bites' }),
    } as unknown as jest.Mocked<OrganisationService>;
    const consumerNotificationPort = {
      notify: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<ConsumerNotificationPort>;

    const service = new CollectionPointFulfillmentService(
      repository,
      outletRepository,
      salesOrderRepository,
      salesFulfilmentService,
      consumerService,
      auditService,
      effectiveAccessResolver,
      inventoryStockRepository,
      organisationService,
      consumerNotificationPort,
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
      inventoryStockRepository,
      organisationService,
      consumerNotificationPort,
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

    // Sprint 42 brief §16/§22 — consumer notification and the payment-reversal guard.
    it('markReadyForCollection: notifies the consumer via the ConsumerNotificationPort on success', async () => {
      const {
        service,
        repository,
        outletRepository,
        salesFulfilmentService,
        consumerNotificationPort,
      } = makeService();
      const preparing = { ...cpf, status: CollectionPointFulfillmentStatus.PREPARING };
      repository.findById.mockResolvedValue(preparing as never);
      outletRepository.findById.mockResolvedValue({
        ...eligibleOutlet,
        address: '12 Bodija Market Road',
        collectionPointOperatingHours: 'Mon-Sat 9am-6pm',
      } as never);
      salesFulfilmentService.getAvailability.mockResolvedValue([]);
      repository.updateStatus.mockResolvedValue({
        ...preparing,
        status: CollectionPointFulfillmentStatus.READY_FOR_COLLECTION,
      } as never);

      await service.markReadyForCollection(orgId, 'cpf-1', 'rep-1');

      expect(consumerNotificationPort.notify).toHaveBeenCalledTimes(1);
      const [request] = consumerNotificationPort.notify.mock.calls[0]!;
      expect(request.organisationId).toBe(orgId);
      expect(request.consumerId).toBe('consumer-1');
      expect(request.salesOrderId).toBe('so-1');
      expect(request.kind).toBe('COLLECTION_READY');
      expect(request.message).toContain('SO-000001');
      expect(request.message).toContain('Bodija Supermart');
      expect(request.message).toContain('12 Bodija Market Road');
      expect(request.message).toContain('Mon-Sat 9am-6pm');
      expect(request.message).not.toMatch(/undefined|null/);
    });

    it("markReadyForCollection: rejects when the order's latest payment is no longer valid (VOIDED)", async () => {
      const { service, repository, outletRepository } = makeService();
      const preparing = {
        ...cpf,
        status: CollectionPointFulfillmentStatus.PREPARING,
        salesOrder: {
          ...cpf.salesOrder,
          payments: [{ status: 'VOIDED', paymentDate: new Date() }],
        },
      };
      repository.findById.mockResolvedValue(preparing as never);
      outletRepository.findById.mockResolvedValue(eligibleOutlet as never);

      await expect(service.markReadyForCollection(orgId, 'cpf-1', 'rep-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(repository.updateStatus).not.toHaveBeenCalled();
    });

    it("startPreparing: rejects when the order's latest payment has been reversed", async () => {
      const { service, repository } = makeService();
      repository.findById.mockResolvedValue({
        ...cpf,
        salesOrder: {
          ...cpf.salesOrder,
          payments: [{ status: 'FAILED', paymentDate: new Date() }],
        },
      } as never);

      await expect(service.startPreparing(orgId, 'cpf-1', 'rep-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(repository.updateStatus).not.toHaveBeenCalled();
    });

    it('startPreparing: a consumer order with no payment row at all (documented admin edge case) is unaffected', async () => {
      const { service, repository } = makeService();
      repository.findById.mockResolvedValue({
        ...cpf,
        salesOrder: { ...cpf.salesOrder, payments: [] },
      } as never);
      repository.updateStatus.mockResolvedValue({
        ...cpf,
        status: CollectionPointFulfillmentStatus.PREPARING,
      } as never);

      await expect(service.startPreparing(orgId, 'cpf-1', 'rep-1')).resolves.toBeDefined();
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

    // Sprint 42 brief §20/§28.
    it('notifies the consumer via the ConsumerNotificationPort on a genuine (winning) collection', async () => {
      const {
        service,
        repository,
        outletRepository,
        salesOrderRepository,
        consumerNotificationPort,
      } = makeService();
      repository.findById.mockResolvedValue(ready as never);
      repository.updateStatus.mockResolvedValue({
        ...ready,
        status: CollectionPointFulfillmentStatus.COLLECTED,
      } as never);
      outletRepository.findById.mockResolvedValue(eligibleOutlet as never);
      salesOrderRepository.findById.mockResolvedValue(order as never);

      await service.confirmCollection(orgId, 'cpf-1', 'rep-1');

      expect(consumerNotificationPort.notify).toHaveBeenCalledTimes(1);
      const [request] = consumerNotificationPort.notify.mock.calls[0]!;
      expect(request.consumerId).toBe('consumer-1');
      expect(request.salesOrderId).toBe('so-1');
      expect(request.kind).toBe('COLLECTION_CONFIRMED');
      expect(request.message).toContain('SO-000001');
      expect(request.message).toContain('collected');
    });

    it('never re-notifies on an idempotent duplicate confirmation (the replay path exits before the notify call)', async () => {
      const { service, repository, salesFulfilmentService, consumerNotificationPort } =
        makeService();
      const collected = { ...ready, status: CollectionPointFulfillmentStatus.COLLECTED };
      repository.findById.mockResolvedValue(collected as never);
      repository.updateStatus.mockResolvedValue(null); // no rows matched — already COLLECTED

      await service.confirmCollection(orgId, 'cpf-1', 'rep-1');

      expect(salesFulfilmentService.fulfil).not.toHaveBeenCalled();
      expect(consumerNotificationPort.notify).not.toHaveBeenCalled();
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

  /** Added Sprint 39 — found via live verification: an outlet can be `ENABLED` +
   *  `ACTIVE` but still lack a configured `inventoryLocationId`, making it appear
   *  selectable in a naive "enabled outlets" picker while `reassign()` would reject it.
   *  This method must apply the full eligibility check, not just `collectionPointStatus`. */
  describe('listEligibleOutletsForReassignment', () => {
    it('excludes an ENABLED+ACTIVE outlet with no inventory location configured', async () => {
      const { service, outletRepository, effectiveAccessResolver } = makeService();
      effectiveAccessResolver.resolve.mockResolvedValue({
        isOwnerBypass: false,
        grants: new Map([['sales.customer.manage', {}]]),
      } as never);
      const noInventoryLocation = {
        ...eligibleOutlet,
        id: 'outlet-2',
        name: 'Mama Ngozi Provisions Shop',
        inventoryLocationId: null,
      };
      outletRepository.findManyByOrganisation.mockResolvedValue([
        eligibleOutlet,
        noInventoryLocation,
      ] as never);

      const result = await service.listEligibleOutletsForReassignment(orgId, 'admin-1');

      expect(result).toEqual([{ id: 'outlet-1', name: 'Bodija Supermart' }]);
    });

    it('rejects a non-admin caller with ForbiddenException', async () => {
      const { service, effectiveAccessResolver } = makeService();
      effectiveAccessResolver.resolve.mockResolvedValue({
        isOwnerBypass: false,
        grants: new Map(),
      } as never);

      await expect(service.listEligibleOutletsForReassignment(orgId, 'rep-1')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('getById — Sprint 38 enriched detail fields', () => {
    it('maps paymentStatus/paidAt from the most recent payment, and consumer.territoryName', async () => {
      const { service, repository } = makeService();
      repository.findById.mockResolvedValue(cpf as never);

      const result = await service.getById(orgId, 'cpf-1', 'rep-1');

      expect(result.paymentStatus).toBe('RECORDED');
      expect(result.paidAt).toEqual(new Date('2026-01-01'));
      expect(result.consumer?.territoryName).toBe('Bodija');
    });

    it('reports paidAt as null when the latest payment is not RECORDED', async () => {
      const { service, repository } = makeService();
      const unpaid = {
        ...cpf,
        salesOrder: {
          ...cpf.salesOrder,
          payments: [{ status: 'PENDING', paymentDate: new Date('2026-01-02') }],
        },
      };
      repository.findById.mockResolvedValue(unpaid as never);

      const result = await service.getById(orgId, 'cpf-1', 'rep-1');

      expect(result.paymentStatus).toBe('PENDING');
      expect(result.paidAt).toBeNull();
    });

    it('reports paymentStatus/paidAt as null when the order has no payment row at all', async () => {
      const { service, repository } = makeService();
      const noPayment = {
        ...cpf,
        salesOrder: { ...cpf.salesOrder, payments: [] },
      };
      repository.findById.mockResolvedValue(noPayment as never);

      const result = await service.getById(orgId, 'cpf-1', 'rep-1');

      expect(result.paymentStatus).toBeNull();
      expect(result.paidAt).toBeNull();
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

  describe('getInventoryViewForOutlet — Sprint 38 Field inventory view', () => {
    const queuedCpf = {
      ...cpf,
      status: CollectionPointFulfillmentStatus.PREPARING,
      salesOrder: {
        ...cpf.salesOrder,
        items: [
          { id: 'item-1', quantity: 10, product: { id: 'product-1', name: 'Snack', unit: 'pack' } },
        ],
      },
    };

    it('reports SUFFICIENT when available stock covers required quantity', async () => {
      const { service, outletRepository, repository, inventoryStockRepository } = makeService();
      outletRepository.findById.mockResolvedValue(eligibleOutlet as never);
      repository.findManyByOutlet.mockResolvedValue([queuedCpf] as never);
      inventoryStockRepository.findManyByProductsAndLocation.mockResolvedValue([
        { productId: 'product-1', quantityOnHand: 24 },
      ] as never);

      const result = await service.getInventoryViewForOutlet(orgId, 'outlet-1', 'rep-1');

      expect(result).toEqual([
        {
          productId: 'product-1',
          productName: 'Snack',
          unit: 'pack',
          available: 24,
          required: 10,
          shortfall: 0,
          status: 'SUFFICIENT',
        },
      ]);
    });

    it('reports SHORT with the correct shortfall when available stock is insufficient', async () => {
      const { service, outletRepository, repository, inventoryStockRepository } = makeService();
      outletRepository.findById.mockResolvedValue(eligibleOutlet as never);
      repository.findManyByOutlet.mockResolvedValue([queuedCpf] as never);
      inventoryStockRepository.findManyByProductsAndLocation.mockResolvedValue([
        { productId: 'product-1', quantityOnHand: 4 },
      ] as never);

      const result = await service.getInventoryViewForOutlet(orgId, 'outlet-1', 'rep-1');

      expect(result).toEqual([
        expect.objectContaining({ available: 4, required: 10, shortfall: 6, status: 'SHORT' }),
      ]);
    });

    it('sums required quantity across multiple queued orders for the same product', async () => {
      const { service, outletRepository, repository, inventoryStockRepository } = makeService();
      outletRepository.findById.mockResolvedValue(eligibleOutlet as never);
      const second = { ...queuedCpf, id: 'cpf-2' };
      repository.findManyByOutlet.mockResolvedValue([queuedCpf, second] as never);
      inventoryStockRepository.findManyByProductsAndLocation.mockResolvedValue([
        { productId: 'product-1', quantityOnHand: 24 },
      ] as never);

      const result = await service.getInventoryViewForOutlet(orgId, 'outlet-1', 'rep-1');

      expect(result).toEqual([expect.objectContaining({ required: 20, available: 24 })]);
    });

    it('treats a product with no InventoryStock row as 0 available', async () => {
      const { service, outletRepository, repository, inventoryStockRepository } = makeService();
      outletRepository.findById.mockResolvedValue(eligibleOutlet as never);
      repository.findManyByOutlet.mockResolvedValue([queuedCpf] as never);
      inventoryStockRepository.findManyByProductsAndLocation.mockResolvedValue([] as never);

      const result = await service.getInventoryViewForOutlet(orgId, 'outlet-1', 'rep-1');

      expect(result).toEqual([expect.objectContaining({ available: 0, shortfall: 10 })]);
    });

    it('returns an empty list when the outlet has no inventory location configured', async () => {
      const { service, outletRepository, repository } = makeService();
      outletRepository.findById.mockResolvedValue({
        ...eligibleOutlet,
        inventoryLocationId: null,
      } as never);

      const result = await service.getInventoryViewForOutlet(orgId, 'outlet-1', 'rep-1');

      expect(result).toEqual([]);
      expect(repository.findManyByOutlet).not.toHaveBeenCalled();
    });

    it('returns an empty list when nothing is queued', async () => {
      const { service, outletRepository, repository } = makeService();
      outletRepository.findById.mockResolvedValue(eligibleOutlet as never);
      repository.findManyByOutlet.mockResolvedValue([] as never);

      const result = await service.getInventoryViewForOutlet(orgId, 'outlet-1', 'rep-1');

      expect(result).toEqual([]);
    });

    it('rejects a caller who is neither the assigned rep nor an admin', async () => {
      const { service, outletRepository } = makeService();
      outletRepository.findById.mockResolvedValue(eligibleOutlet as never);

      await expect(
        service.getInventoryViewForOutlet(orgId, 'outlet-1', 'stranger'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects a cross-tenant outlet id with NotFoundException', async () => {
      const { service, outletRepository } = makeService();
      outletRepository.findById.mockResolvedValue(null);

      await expect(service.getInventoryViewForOutlet(orgId, 'outlet-1', 'rep-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('queries only ASSIGNED/PREPARING/READY_FOR_COLLECTION fulfilments, never COLLECTED (already-deducted stock must not be double-counted as still required)', async () => {
      const { service, outletRepository, repository } = makeService();
      outletRepository.findById.mockResolvedValue(eligibleOutlet as never);
      repository.findManyByOutlet.mockResolvedValue([] as never);

      await service.getInventoryViewForOutlet(orgId, 'outlet-1', 'rep-1');

      expect(repository.findManyByOutlet).toHaveBeenCalledWith(orgId, 'outlet-1', [
        'ASSIGNED',
        'PREPARING',
        'READY_FOR_COLLECTION',
      ]);
    });
  });

  /** Added Sprint 39 — the D2C Admin's org-wide Collection Point summary. */
  describe('listAll', () => {
    it('rejects a non-admin caller with ForbiddenException', async () => {
      const { service, effectiveAccessResolver } = makeService();
      effectiveAccessResolver.resolve.mockResolvedValue({
        isOwnerBypass: false,
        grants: new Map(),
      } as never);

      await expect(service.listAll(orgId, 'rep-1', { page: 1, pageSize: 20 })).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('maps every row through toResult and returns the total for an admin caller', async () => {
      const { service, repository, effectiveAccessResolver } = makeService();
      effectiveAccessResolver.resolve.mockResolvedValue({
        isOwnerBypass: false,
        grants: new Map([['sales.customer.manage', {}]]),
      } as never);
      repository.findManyPaginated.mockResolvedValue({ items: [cpf], total: 1 } as never);

      const result = await service.listAll(orgId, 'admin-1', { page: 1, pageSize: 20 });
      expect(result.total).toBe(1);
      expect(result.items[0]?.id).toBe('cpf-1');
    });
  });

  /** Added Sprint 39 — the D2C Admin Order Detail page's collection-status lookup. */
  describe('getBySalesOrderId', () => {
    it('returns null (not a thrown error) when the order has never been assigned', async () => {
      const { service, repository } = makeService();
      repository.findBySalesOrderId.mockResolvedValue(null);

      const result = await service.getBySalesOrderId(orgId, 'so-unassigned', 'admin-1');
      expect(result).toBeNull();
    });

    it('still enforces the same authorization as getById for an assigned order', async () => {
      const { service, repository, effectiveAccessResolver } = makeService();
      repository.findBySalesOrderId.mockResolvedValue(cpf as never);
      effectiveAccessResolver.resolve.mockResolvedValue({
        isOwnerBypass: false,
        grants: new Map(),
      } as never);

      await expect(service.getBySalesOrderId(orgId, 'so-1', 'stranger')).rejects.toThrow(
        NotAuthorizedForCollectionPointError,
      );
    });
  });

  /** Added Sprint 39 — the admin-only reassignment override (docs/domains/d2c.md). */
  describe('reassign', () => {
    const otherOutlet = { ...eligibleOutlet, id: 'outlet-2', name: 'Other Outlet' };

    function mockAdmin(effectiveAccessResolver: jest.Mocked<EffectiveAccessResolver>) {
      effectiveAccessResolver.resolve.mockResolvedValue({
        isOwnerBypass: false,
        grants: new Map([['sales.customer.manage', {}]]),
      } as never);
    }

    it('rejects a non-admin caller with ForbiddenException, even one holding .fulfil for their own outlet', async () => {
      const { service, repository, effectiveAccessResolver } = makeService();
      repository.findById.mockResolvedValue(cpf as never);
      effectiveAccessResolver.resolve.mockResolvedValue({
        isOwnerBypass: false,
        grants: new Map(),
      } as never);

      await expect(service.reassign(orgId, 'cpf-1', 'outlet-2', 'rep-1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('moves the fulfilment to the new outlet and audits the reassignment', async () => {
      const { service, repository, outletRepository, effectiveAccessResolver, auditService } =
        makeService();
      mockAdmin(effectiveAccessResolver);
      repository.findById.mockResolvedValue(cpf as never);
      outletRepository.findById.mockResolvedValue(otherOutlet as never);
      repository.reassignOutlet.mockResolvedValue({ ...cpf, outletId: 'outlet-2' } as never);

      const result = await service.reassign(orgId, 'cpf-1', 'outlet-2', 'admin-1');

      expect(result.outletId).toBe('outlet-2');
      expect(repository.reassignOutlet).toHaveBeenCalledWith(
        orgId,
        'cpf-1',
        ['ASSIGNED', 'PREPARING'],
        'outlet-2',
      );
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'collection_point_fulfillment.reassigned' }),
      );
    });

    it('rejects reassigning to an ineligible outlet (e.g. not an enabled Collection Point)', async () => {
      const { service, repository, outletRepository, effectiveAccessResolver } = makeService();
      mockAdmin(effectiveAccessResolver);
      repository.findById.mockResolvedValue(cpf as never);
      outletRepository.findById.mockResolvedValue({
        ...otherOutlet,
        collectionPointStatus: 'DISABLED',
      } as never);

      await expect(service.reassign(orgId, 'cpf-1', 'outlet-2', 'admin-1')).rejects.toThrow(
        CollectionPointNotEligibleError,
      );
    });

    it('rejects reassigning to the same outlet the order is already at', async () => {
      const { service, repository, outletRepository, effectiveAccessResolver } = makeService();
      mockAdmin(effectiveAccessResolver);
      repository.findById.mockResolvedValue(cpf as never);
      outletRepository.findById.mockResolvedValue(eligibleOutlet as never);

      await expect(service.reassign(orgId, 'cpf-1', 'outlet-1', 'admin-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects reassignment once the order is READY_FOR_COLLECTION or later (the repository no-op path)', async () => {
      const { service, repository, outletRepository, effectiveAccessResolver } = makeService();
      mockAdmin(effectiveAccessResolver);
      repository.findById.mockResolvedValue({
        ...cpf,
        status: CollectionPointFulfillmentStatus.READY_FOR_COLLECTION,
      } as never);
      outletRepository.findById.mockResolvedValue(otherOutlet as never);
      repository.reassignOutlet.mockResolvedValue(null);

      await expect(service.reassign(orgId, 'cpf-1', 'outlet-2', 'admin-1')).rejects.toThrow(
        InvalidFulfillmentTransitionError,
      );
    });
  });
});
