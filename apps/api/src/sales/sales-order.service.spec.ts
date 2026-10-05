import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  Customer,
  CustomerStatus,
  Outlet,
  OutletStatus,
  Product,
  SalesOrderSource,
  SalesOrderStatus,
} from '@prisma/client';

import { ProductRepository } from '../catalogue/product/product.repository';
import { CustomerRepository } from '../retail/customer/customer.repository';
import { OutletRepository } from '../retail/outlet/outlet.repository';
import { SalesOrderRepository, SalesOrderWithRelations } from './sales-order.repository';
import { SalesOrderService } from './sales-order.service';

describe('SalesOrderService', () => {
  const customer: Customer = {
    id: 'customer-1',
    organisationId: 'org-1',
    customerCode: 'CUS-000001',
    customerType: 'SUPERMARKET',
    customerName: 'Bodija Supermart',
    contactPersonName: null,
    phoneNumber: '+2348030000001',
    alternatePhoneNumber: null,
    email: null,
    address: null,
    city: null,
    state: null,
    country: null,
    territoryId: null,
    status: CustomerStatus.ACTIVE,
    notes: null,
    createdById: 'user-1',
    updatedById: 'user-1',
    createdAt: new Date('2026-08-21'),
    updatedAt: new Date('2026-08-21'),
  };

  const outlet: Outlet = {
    id: 'outlet-1',
    organisationId: 'org-1',
    customerId: 'customer-1',
    outletCode: 'OUT-000001',
    outletType: 'SUPERMARKET',
    name: 'Bodija Supermart — Main Branch',
    contactPersonName: null,
    phoneNumber: null,
    address: null,
    city: null,
    state: null,
    country: null,
    territoryId: null,
    latitude: null,
    longitude: null,
    status: OutletStatus.ACTIVE,
    notes: null,
    collectionPointStatus: 'DISABLED',
    collectionPointResponsibleUserId: null,
    collectionPointOperatingHours: null,
    inventoryLocationId: null,
    createdById: 'user-1',
    updatedById: 'user-1',
    createdAt: new Date('2026-08-21'),
    updatedAt: new Date('2026-08-21'),
  };

  const finishedProduct: Product = {
    id: 'product-1',
    organisationId: 'org-1',
    code: 'PRD-000030',
    name: 'Plantain Chips Sweet & Spicy 30g',
    displayName: null,
    slug: 'plantain-chips-sweet-spicy-30g',
    category: 'SNACKS',
    type: 'FINISHED_PRODUCT',
    shortDescription: null,
    longDescription: null,
    unit: 'Pack',
    imageUrl: null,
    imageKey: null,
    status: 'ACTIVE',
    createdById: 'user-1',
    updatedById: 'user-1',
    createdAt: new Date('2026-08-21'),
    updatedAt: new Date('2026-08-21'),
    sellingPrice: null,
    productVariantId: null,
  };

  const rawMaterial: Product = {
    ...finishedProduct,
    id: 'product-2',
    code: 'PRD-000011',
    type: 'RAW_MATERIAL',
  };

  const order: SalesOrderWithRelations = {
    id: 'order-1',
    organisationId: 'org-1',
    orderCode: 'SO-000001',
    customerId: 'customer-1',
    outletId: 'outlet-1',
    consumerId: null,
    salesAgentId: 'user-1',
    source: SalesOrderSource.B2B,
    status: SalesOrderStatus.DRAFT,
    orderDate: new Date('2026-08-21'),
    notes: null,
    subtotal: 500,
    discount: 0,
    total: 500,
    idempotencyKey: null,
    createdById: 'user-1',
    updatedById: 'user-1',
    createdAt: new Date('2026-08-21'),
    updatedAt: new Date('2026-08-21'),
    customer: { id: 'customer-1', customerCode: 'CUS-000001', customerName: 'Bodija Supermart' },
    outlet: { id: 'outlet-1', outletCode: 'OUT-000001', name: 'Bodija Supermart — Main Branch' },
    consumer: null,
    items: [
      {
        id: 'item-1',
        productId: 'product-1',
        quantity: 2,
        quantityFulfilled: 0,
        unitPrice: 250,
        lineTotal: 500,
        product: { id: 'product-1', code: 'PRD-000030', name: finishedProduct.name, unit: 'Pack' },
      },
    ],
  };

  function makeService() {
    const salesOrderRepository = {
      create: jest.fn(),
      findById: jest.fn(),
      findByIdempotencyKey: jest.fn(),
      findManyByOrganisation: jest.fn(),
      existsByCode: jest.fn().mockResolvedValue(false),
      update: jest.fn(),
      updateStatus: jest.fn(),
    } as unknown as jest.Mocked<SalesOrderRepository>;
    const customerRepository = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<CustomerRepository>;
    const outletRepository = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<OutletRepository>;
    const productRepository = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<ProductRepository>;

    const service = new SalesOrderService(
      salesOrderRepository,
      customerRepository,
      outletRepository,
      productRepository,
    );
    return {
      service,
      salesOrderRepository,
      customerRepository,
      outletRepository,
      productRepository,
    };
  }

  describe('create', () => {
    it('creates the order atomically via a nested items create, with server-computed totals', async () => {
      const {
        service,
        salesOrderRepository,
        customerRepository,
        outletRepository,
        productRepository,
      } = makeService();
      customerRepository.findById.mockResolvedValue(customer);
      outletRepository.findById.mockResolvedValue(outlet);
      productRepository.findById.mockResolvedValue(finishedProduct);
      salesOrderRepository.create.mockResolvedValue(order);

      await service.create(
        'org-1',
        {
          customerId: 'customer-1',
          outletId: 'outlet-1',
          orderDate: new Date('2026-08-21'),
          discount: 0,
          items: [{ productId: 'product-1', quantity: 2, unitPrice: 250 }],
        },
        'user-1',
      );

      expect(salesOrderRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          orderCode: 'SO-000001',
          subtotal: 500,
          total: 500,
          items: { create: [expect.objectContaining({ productId: 'product-1', lineTotal: 500 })] },
        }),
      );
    });

    it('ignores any client-supplied lineTotal — always recomputes quantity * unitPrice', async () => {
      const { service, salesOrderRepository, customerRepository, productRepository } =
        makeService();
      customerRepository.findById.mockResolvedValue(customer);
      productRepository.findById.mockResolvedValue(finishedProduct);
      salesOrderRepository.create.mockResolvedValue(order);

      await service.create(
        'org-1',
        {
          customerId: 'customer-1',
          orderDate: new Date('2026-08-21'),
          discount: 0,
          items: [{ productId: 'product-1', quantity: 2, unitPrice: 250 } as never],
        },
        'user-1',
      );

      const createCall = salesOrderRepository.create.mock.calls[0]?.[0] as {
        items: { create: { lineTotal: number }[] };
      };
      expect(createCall.items.create[0]?.lineTotal).toBe(500);
    });

    it('rejects a discount greater than the subtotal', async () => {
      const { service, customerRepository, productRepository } = makeService();
      customerRepository.findById.mockResolvedValue(customer);
      productRepository.findById.mockResolvedValue(finishedProduct);

      await expect(
        service.create(
          'org-1',
          {
            customerId: 'customer-1',
            orderDate: new Date('2026-08-21'),
            discount: 9999,
            items: [{ productId: 'product-1', quantity: 2, unitPrice: 250 }],
          },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a component that is not a finished product', async () => {
      const { service, customerRepository, productRepository } = makeService();
      customerRepository.findById.mockResolvedValue(customer);
      productRepository.findById.mockResolvedValue(rawMaterial);

      await expect(
        service.create(
          'org-1',
          {
            customerId: 'customer-1',
            orderDate: new Date('2026-08-21'),
            discount: 0,
            items: [{ productId: 'product-2', quantity: 1, unitPrice: 100 }],
          },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a cross-tenant productId', async () => {
      const { service, customerRepository, productRepository } = makeService();
      customerRepository.findById.mockResolvedValue(customer);
      productRepository.findById.mockResolvedValue(null);

      await expect(
        service.create(
          'org-1',
          {
            customerId: 'customer-1',
            orderDate: new Date('2026-08-21'),
            discount: 0,
            items: [{ productId: 'other-org-product', quantity: 1, unitPrice: 100 }],
          },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    describe('outlet attribution', () => {
      it('rejects an outlet belonging to a different customer', async () => {
        const { service, customerRepository, outletRepository, productRepository } = makeService();
        customerRepository.findById.mockResolvedValue(customer);
        outletRepository.findById.mockResolvedValue({ ...outlet, customerId: 'other-customer' });
        productRepository.findById.mockResolvedValue(finishedProduct);

        await expect(
          service.create(
            'org-1',
            {
              customerId: 'customer-1',
              outletId: 'outlet-1',
              orderDate: new Date('2026-08-21'),
              discount: 0,
              items: [{ productId: 'product-1', quantity: 1, unitPrice: 250 }],
            },
            'user-1',
          ),
        ).rejects.toThrow(BadRequestException);
      });

      it('rejects a cross-tenant outletId', async () => {
        const { service, customerRepository, outletRepository, productRepository } = makeService();
        customerRepository.findById.mockResolvedValue(customer);
        outletRepository.findById.mockResolvedValue(null);
        productRepository.findById.mockResolvedValue(finishedProduct);

        await expect(
          service.create(
            'org-1',
            {
              customerId: 'customer-1',
              outletId: 'other-org-outlet',
              orderDate: new Date('2026-08-21'),
              discount: 0,
              items: [{ productId: 'product-1', quantity: 1, unitPrice: 250 }],
            },
            'user-1',
          ),
        ).rejects.toThrow(BadRequestException);
      });

      it('rejects an inactive outlet', async () => {
        const { service, customerRepository, outletRepository, productRepository } = makeService();
        customerRepository.findById.mockResolvedValue(customer);
        outletRepository.findById.mockResolvedValue({ ...outlet, status: OutletStatus.INACTIVE });
        productRepository.findById.mockResolvedValue(finishedProduct);

        await expect(
          service.create(
            'org-1',
            {
              customerId: 'customer-1',
              outletId: 'outlet-1',
              orderDate: new Date('2026-08-21'),
              discount: 0,
              items: [{ productId: 'product-1', quantity: 1, unitPrice: 250 }],
            },
            'user-1',
          ),
        ).rejects.toThrow(BadRequestException);
      });

      it('succeeds when outletId is omitted entirely', async () => {
        const {
          service,
          salesOrderRepository,
          customerRepository,
          outletRepository,
          productRepository,
        } = makeService();
        customerRepository.findById.mockResolvedValue(customer);
        productRepository.findById.mockResolvedValue(finishedProduct);
        salesOrderRepository.create.mockResolvedValue({ ...order, outletId: null, outlet: null });

        await service.create(
          'org-1',
          {
            customerId: 'customer-1',
            orderDate: new Date('2026-08-21'),
            discount: 0,
            items: [{ productId: 'product-1', quantity: 1, unitPrice: 250 }],
          },
          'user-1',
        );

        expect(outletRepository.findById).not.toHaveBeenCalled();
      });
    });
  });

  describe('createForConsumer (Sprint 34)', () => {
    const pricedProduct: Product = { ...finishedProduct, id: 'product-priced', sellingPrice: 500 };
    const unpricedProduct: Product = {
      ...finishedProduct,
      id: 'product-unpriced',
      sellingPrice: null,
    };

    function d2cOrder(overrides: Partial<SalesOrderWithRelations> = {}): SalesOrderWithRelations {
      return {
        ...order,
        id: 'order-d2c-1',
        customerId: null,
        outletId: null,
        consumerId: 'consumer-1',
        salesAgentId: null,
        source: SalesOrderSource.D2C,
        idempotencyKey: 'idem-key-1',
        customer: null,
        outlet: null,
        consumer: {
          id: 'consumer-1',
          consumerCode: 'CON-000001',
          fullName: 'Ada Okafor',
          territoryId: null,
          territory: null,
        },
        items: [
          {
            id: 'item-d2c-1',
            productId: pricedProduct.id,
            quantity: 2,
            quantityFulfilled: 0,
            unitPrice: 500,
            lineTotal: 1000,
            product: {
              id: pricedProduct.id,
              code: pricedProduct.code,
              name: pricedProduct.name,
              unit: 'Pack',
            },
          },
        ],
        subtotal: 1000,
        total: 1000,
        ...overrides,
      };
    }

    it('prices every item from the LIVE Product.sellingPrice — never a client-supplied price (there is no such field)', async () => {
      const { service, salesOrderRepository, productRepository } = makeService();
      salesOrderRepository.findByIdempotencyKey.mockResolvedValue(null);
      productRepository.findById.mockResolvedValue(pricedProduct);
      salesOrderRepository.create.mockResolvedValue(d2cOrder());

      const { order: created, wasCreated } = await service.createForConsumer('org-1', {
        consumerId: 'consumer-1',
        items: [{ productId: pricedProduct.id, quantity: 2 }],
        orderDate: new Date('2026-09-28'),
        idempotencyKey: 'idem-key-1',
      });

      expect(wasCreated).toBe(true);
      expect(created.source).toBe('D2C');
      expect(created.consumerId).toBe('consumer-1');
      expect(created.customerId).toBeNull();
      const createArg = salesOrderRepository.create.mock.calls[0]![0] as {
        source: string;
        consumer: { connect: { id: string } };
        items: {
          create: { productId: string; quantity: number; unitPrice: number; lineTotal: number }[];
        };
      };
      expect(createArg.source).toBe('D2C');
      expect(createArg.consumer.connect.id).toBe('consumer-1');
      // The service input has NO `unitPrice` field at all — this asserts the price it
      // actually persisted came from `pricedProduct.sellingPrice` (500), not anything
      // the (nonexistent) caller-supplied price could have been.
      expect(createArg.items.create[0]!.unitPrice).toBe(500);
      expect(createArg.items.create[0]!.lineTotal).toBe(1000);
    });

    it('rejects a product with no sellingPrice (not D2C-orderable)', async () => {
      const { service, salesOrderRepository, productRepository } = makeService();
      salesOrderRepository.findByIdempotencyKey.mockResolvedValue(null);
      productRepository.findById.mockResolvedValue(unpricedProduct);

      await expect(
        service.createForConsumer('org-1', {
          consumerId: 'consumer-1',
          items: [{ productId: unpricedProduct.id, quantity: 1 }],
          orderDate: new Date('2026-09-28'),
          idempotencyKey: 'idem-key-2',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(salesOrderRepository.create).not.toHaveBeenCalled();
    });

    it('rejects a non-finished-product SKU, and a non-tenant-scoped SKU', async () => {
      const { service, salesOrderRepository, productRepository } = makeService();
      salesOrderRepository.findByIdempotencyKey.mockResolvedValue(null);
      productRepository.findById.mockResolvedValueOnce(rawMaterial);
      await expect(
        service.createForConsumer('org-1', {
          consumerId: 'consumer-1',
          items: [{ productId: rawMaterial.id, quantity: 1 }],
          orderDate: new Date('2026-09-28'),
          idempotencyKey: 'idem-key-3',
        }),
      ).rejects.toThrow(BadRequestException);

      productRepository.findById.mockResolvedValueOnce(null);
      await expect(
        service.createForConsumer('org-1', {
          consumerId: 'consumer-1',
          items: [{ productId: 'someone-elses-product', quantity: 1 }],
          orderDate: new Date('2026-09-28'),
          idempotencyKey: 'idem-key-4',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an invalid quantity (zero, negative, non-integer)', async () => {
      const { service, salesOrderRepository, productRepository } = makeService();
      salesOrderRepository.findByIdempotencyKey.mockResolvedValue(null);
      productRepository.findById.mockResolvedValue(pricedProduct);

      for (const quantity of [0, -1, 1.5]) {
        await expect(
          service.createForConsumer('org-1', {
            consumerId: 'consumer-1',
            items: [{ productId: pricedProduct.id, quantity }],
            orderDate: new Date('2026-09-28'),
            idempotencyKey: `idem-key-qty-${quantity}`,
          }),
        ).rejects.toThrow(BadRequestException);
      }
    });

    it('idempotency-before-precheck: an existing idempotency-key match short-circuits before any product validation', async () => {
      const { service, salesOrderRepository, productRepository } = makeService();
      const existing = d2cOrder();
      salesOrderRepository.findByIdempotencyKey.mockResolvedValue(existing);

      const { order: returned, wasCreated } = await service.createForConsumer('org-1', {
        consumerId: 'consumer-1',
        // A deliberately invalid item — if the precheck ran, this would throw. It never
        // runs, because the idempotency lookup returns first (the Sprint 9->10 lesson).
        items: [{ productId: 'this-product-does-not-exist', quantity: -5 }],
        orderDate: new Date('2026-09-28'),
        idempotencyKey: 'idem-key-1',
      });

      expect(wasCreated).toBe(false);
      expect(returned.id).toBe(existing.id);
      expect(productRepository.findById).not.toHaveBeenCalled();
      expect(salesOrderRepository.create).not.toHaveBeenCalled();
    });

    it('a genuine concurrent race (P2002 on the idempotency key) recovers by re-fetching the winner, never surfaces the raw DB error', async () => {
      const { service, salesOrderRepository, productRepository } = makeService();
      productRepository.findById.mockResolvedValue(pricedProduct);
      const winner = d2cOrder();
      salesOrderRepository.findByIdempotencyKey
        .mockResolvedValueOnce(null) // this call's own pre-check: no existing order yet
        .mockResolvedValueOnce(winner); // the recovery re-fetch after losing the race
      const p2002 = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
      Object.setPrototypeOf(
        p2002,
        jest.requireActual('@prisma/client').Prisma.PrismaClientKnownRequestError.prototype,
      );
      salesOrderRepository.create.mockRejectedValue(p2002);

      const { order: returned, wasCreated } = await service.createForConsumer('org-1', {
        consumerId: 'consumer-1',
        items: [{ productId: pricedProduct.id, quantity: 1 }],
        orderDate: new Date('2026-09-28'),
        idempotencyKey: 'idem-key-1',
      });

      expect(wasCreated).toBe(false);
      expect(returned.id).toBe(winner.id);
    });
  });

  describe('status transitions', () => {
    it('confirms a DRAFT order', async () => {
      const { service, salesOrderRepository } = makeService();
      salesOrderRepository.findById.mockResolvedValue(order);
      salesOrderRepository.updateStatus.mockResolvedValue({
        ...order,
        status: SalesOrderStatus.CONFIRMED,
      });

      await service.confirm('org-1', 'order-1', 'user-1');

      expect(salesOrderRepository.updateStatus).toHaveBeenCalledWith(
        'org-1',
        'order-1',
        [SalesOrderStatus.DRAFT],
        SalesOrderStatus.CONFIRMED,
        'user-1',
      );
    });

    it('rejects confirming an already-confirmed order with a distinct message', async () => {
      const { service, salesOrderRepository } = makeService();
      salesOrderRepository.findById.mockResolvedValue({
        ...order,
        status: SalesOrderStatus.CONFIRMED,
      });

      await expect(service.confirm('org-1', 'order-1', 'user-1')).rejects.toThrow(
        'Sales order is already confirmed',
      );
    });

    it('rejects confirming a cancelled order with a distinct message', async () => {
      const { service, salesOrderRepository } = makeService();
      salesOrderRepository.findById.mockResolvedValue({
        ...order,
        status: SalesOrderStatus.CANCELLED,
      });

      await expect(service.confirm('org-1', 'order-1', 'user-1')).rejects.toThrow(
        'This sales order has been cancelled',
      );
    });

    it('cancels from DRAFT', async () => {
      const { service, salesOrderRepository } = makeService();
      salesOrderRepository.findById.mockResolvedValue(order);
      salesOrderRepository.updateStatus.mockResolvedValue({
        ...order,
        status: SalesOrderStatus.CANCELLED,
      });

      await service.cancel('org-1', 'order-1', 'user-1');

      expect(salesOrderRepository.updateStatus).toHaveBeenCalledWith(
        'org-1',
        'order-1',
        [SalesOrderStatus.DRAFT, SalesOrderStatus.CONFIRMED],
        SalesOrderStatus.CANCELLED,
        'user-1',
      );
    });

    it('cancels from CONFIRMED', async () => {
      const { service, salesOrderRepository } = makeService();
      salesOrderRepository.findById.mockResolvedValue({
        ...order,
        status: SalesOrderStatus.CONFIRMED,
      });
      salesOrderRepository.updateStatus.mockResolvedValue({
        ...order,
        status: SalesOrderStatus.CANCELLED,
      });

      await expect(service.cancel('org-1', 'order-1', 'user-1')).resolves.toBeDefined();
    });

    it('rejects cancelling an already-cancelled order', async () => {
      const { service, salesOrderRepository } = makeService();
      salesOrderRepository.findById.mockResolvedValue({
        ...order,
        status: SalesOrderStatus.CANCELLED,
      });

      await expect(service.cancel('org-1', 'order-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects cancelling a PARTIALLY_FULFILLED order with a distinct message (Sprint 4.9)', async () => {
      const { service, salesOrderRepository } = makeService();
      salesOrderRepository.findById.mockResolvedValue({
        ...order,
        status: SalesOrderStatus.PARTIALLY_FULFILLED,
      });

      await expect(service.cancel('org-1', 'order-1', 'user-1')).rejects.toThrow(
        'Cannot cancel an order after fulfilment has started',
      );
      expect(salesOrderRepository.updateStatus).not.toHaveBeenCalled();
    });

    it('rejects cancelling a FULFILLED order with a distinct message (Sprint 4.9)', async () => {
      const { service, salesOrderRepository } = makeService();
      salesOrderRepository.findById.mockResolvedValue({
        ...order,
        status: SalesOrderStatus.FULFILLED,
      });

      await expect(service.cancel('org-1', 'order-1', 'user-1')).rejects.toThrow(
        'Cannot cancel an order after fulfilment has started',
      );
      expect(salesOrderRepository.updateStatus).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('only allows edits while DRAFT', async () => {
      const { service, salesOrderRepository } = makeService();
      salesOrderRepository.findById.mockResolvedValue({
        ...order,
        status: SalesOrderStatus.CONFIRMED,
      });

      await expect(service.update('org-1', 'order-1', { notes: 'x' }, 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('tenant isolation', () => {
    it('getById throws NotFoundException for an order belonging to another organisation', async () => {
      const { service, salesOrderRepository } = makeService();
      salesOrderRepository.findById.mockResolvedValue(null);

      await expect(service.getById('org-2', 'order-1')).rejects.toThrow(NotFoundException);
    });
  });
});
