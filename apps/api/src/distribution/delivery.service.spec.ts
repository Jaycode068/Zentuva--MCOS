import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DispatchStatus } from '@prisma/client';

import { FileStorage } from '../identity/organisation/ports/file-storage.port';
import { DispatchRepository, DispatchWithRelations } from './dispatch.repository';
import {
  CreateDeliveryResult,
  DeliveryConflictError,
  DeliveryRepository,
  DeliveryWithItems,
  OverDeliveryError,
} from './delivery.repository';
import { DeliveryService } from './delivery.service';

describe('DeliveryService', () => {
  const dispatch: DispatchWithRelations = {
    id: 'dispatch-1',
    organisationId: 'org-1',
    dispatchCode: 'DSP-000001',
    salesFulfilmentId: 'fulfilment-1',
    salesOrderId: 'order-1',
    customerId: 'customer-1',
    outletId: 'outlet-1',
    sourceLocationId: 'location-1',
    dispatchDate: new Date('2026-08-22'),
    status: DispatchStatus.DISPATCHED,
    notes: null,
    idempotencyKey: null,
    createdById: 'user-1',
    updatedById: 'user-1',
    createdAt: new Date('2026-08-22'),
    updatedAt: new Date('2026-08-22'),
    salesFulfilment: { id: 'fulfilment-1', fulfilmentDate: new Date('2026-08-20') },
    salesOrder: { id: 'order-1', orderCode: 'SO-000010' },
    customer: {
      id: 'customer-1',
      customerCode: 'CUS-000010',
      customerName: 'Mama Nkechi Stores',
      territoryId: null,
    },
    outlet: null,
    sourceLocation: { id: 'location-1', name: 'Main Warehouse' },
    items: [
      {
        id: 'dispatch-item-1',
        productId: 'product-1',
        salesFulfilmentItemId: 'fulfilment-item-1',
        quantityDispatched: 500,
        quantityDelivered: 0,
        product: { id: 'product-1', code: 'PRD-000027', name: 'Plantain Chips 500g', unit: 'Pack' },
      },
    ],
  } as unknown as DispatchWithRelations;

  const delivery: DeliveryWithItems = {
    id: 'delivery-1',
    organisationId: 'org-1',
    dispatchId: 'dispatch-1',
    deliveryDate: new Date('2026-08-23'),
    receivedByName: 'Nkechi Obi',
    notes: null,
    photoUrl: null,
    photoKey: null,
    idempotencyKey: null,
    createdById: 'user-1',
    createdAt: new Date('2026-08-23'),
    items: [
      {
        id: 'delivery-item-1',
        productId: 'product-1',
        dispatchItemId: 'dispatch-item-1',
        quantityDelivered: 470,
        product: { id: 'product-1', code: 'PRD-000027', name: 'Plantain Chips 500g', unit: 'Pack' },
      },
    ],
  } as unknown as DeliveryWithItems;

  function makeService() {
    const deliveryRepository = {
      findManyByDispatch: jest.fn(),
      findById: jest.fn(),
      setPhoto: jest.fn(),
      create: jest.fn(),
    } as unknown as jest.Mocked<DeliveryRepository>;
    const dispatchRepository = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<DispatchRepository>;
    const fileStorage = {
      upload: jest.fn(),
      delete: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<FileStorage>;

    const service = new DeliveryService(deliveryRepository, dispatchRepository, fileStorage);
    return { service, deliveryRepository, dispatchRepository, fileStorage };
  }

  describe('create', () => {
    it('rejects delivery for a dispatch that is not yet eligible (READY)', async () => {
      const { service, dispatchRepository } = makeService();
      dispatchRepository.findById.mockResolvedValue({ ...dispatch, status: DispatchStatus.READY });

      await expect(
        service.create(
          'org-1',
          'dispatch-1',
          {
            deliveryDate: new Date(),
            items: [{ dispatchItemId: 'dispatch-item-1', quantity: 470 }],
          },
          'user-1',
        ),
      ).rejects.toThrow('This dispatch is not eligible for delivery confirmation');
    });

    it('rejects an item that does not belong to this dispatch', async () => {
      const { service, dispatchRepository } = makeService();
      dispatchRepository.findById.mockResolvedValue(dispatch);

      await expect(
        service.create(
          'org-1',
          'dispatch-1',
          { deliveryDate: new Date(), items: [{ dispatchItemId: 'not-an-item', quantity: 1 }] },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an over-delivery beyond the dispatched quantity', async () => {
      const { service, dispatchRepository, deliveryRepository } = makeService();
      dispatchRepository.findById.mockResolvedValue(dispatch);

      await expect(
        service.create(
          'org-1',
          'dispatch-1',
          {
            deliveryDate: new Date(),
            items: [{ dispatchItemId: 'dispatch-item-1', quantity: 600 }],
          },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(deliveryRepository.create).not.toHaveBeenCalled();
    });

    it('allows a partial (short) delivery and delegates to the repository', async () => {
      const { service, dispatchRepository, deliveryRepository } = makeService();
      dispatchRepository.findById.mockResolvedValue(dispatch);
      const result: CreateDeliveryResult = {
        delivery,
        dispatch: { ...dispatch, status: DispatchStatus.PARTIALLY_DELIVERED },
        wasCreated: true,
      };
      deliveryRepository.create.mockResolvedValue(result);

      const outcome = await service.create(
        'org-1',
        'dispatch-1',
        {
          deliveryDate: new Date('2026-08-23'),
          receivedByName: 'Nkechi Obi',
          notes: '30 units damaged in transit',
          idempotencyKey: 'key-1',
          items: [{ dispatchItemId: 'dispatch-item-1', quantity: 470 }],
        },
        'user-1',
      );

      expect(deliveryRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          organisationId: 'org-1',
          dispatchId: 'dispatch-1',
          idempotencyKey: 'key-1',
          items: [{ productId: 'product-1', dispatchItemId: 'dispatch-item-1', quantity: 470 }],
        }),
      );
      expect(outcome.dispatch.status).toBe(DispatchStatus.PARTIALLY_DELIVERED);
    });

    it('translates a repository OverDeliveryError into a BadRequestException', async () => {
      const { service, dispatchRepository, deliveryRepository } = makeService();
      dispatchRepository.findById.mockResolvedValue(dispatch);
      deliveryRepository.create.mockRejectedValue(new OverDeliveryError('race'));

      await expect(
        service.create(
          'org-1',
          'dispatch-1',
          {
            deliveryDate: new Date(),
            items: [{ dispatchItemId: 'dispatch-item-1', quantity: 470 }],
          },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('translates a repository DeliveryConflictError into a BadRequestException', async () => {
      const { service, dispatchRepository, deliveryRepository } = makeService();
      dispatchRepository.findById.mockResolvedValue(dispatch);
      deliveryRepository.create.mockRejectedValue(new DeliveryConflictError('conflict'));

      await expect(
        service.create(
          'org-1',
          'dispatch-1',
          {
            deliveryDate: new Date(),
            items: [{ dispatchItemId: 'dispatch-item-1', quantity: 470 }],
          },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException for an unknown/cross-tenant dispatch', async () => {
      const { service, dispatchRepository } = makeService();
      dispatchRepository.findById.mockResolvedValue(null);

      await expect(
        service.create(
          'org-1',
          'unknown',
          { deliveryDate: new Date(), items: [{ dispatchItemId: 'dispatch-item-1', quantity: 1 }] },
          'user-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('setPhoto', () => {
    it('uploads and deletes the previous key when one existed', async () => {
      const { service, deliveryRepository, fileStorage } = makeService();
      deliveryRepository.findById.mockResolvedValue({ ...delivery, photoKey: 'old-key' });
      fileStorage.upload.mockResolvedValue({ url: 'https://x/photo.png', key: 'new-key' });
      deliveryRepository.setPhoto.mockResolvedValue({
        ...delivery,
        photoUrl: 'https://x/photo.png',
        photoKey: 'new-key',
      });

      await service.setPhoto('org-1', 'delivery-1', {
        mimeType: 'image/png',
        buffer: Buffer.from('x'),
      });

      expect(fileStorage.delete).toHaveBeenCalledWith('old-key');
    });

    it('throws NotFoundException for an unknown/cross-tenant delivery', async () => {
      const { service, deliveryRepository } = makeService();
      deliveryRepository.findById.mockResolvedValue(null);

      await expect(
        service.setPhoto('org-1', 'unknown', { mimeType: 'image/png', buffer: Buffer.from('x') }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
