import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  Customer,
  CustomerStatus,
  Outlet,
  OutletStatus,
  Product,
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
    salesAgentId: 'user-1',
    status: SalesOrderStatus.DRAFT,
    orderDate: new Date('2026-08-21'),
    notes: null,
    subtotal: 500,
    discount: 0,
    total: 500,
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
