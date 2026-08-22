import { readFileSync } from 'fs';
import { join } from 'path';

import { Customer, CustomerStatus, CustomerType, Product } from '@prisma/client';

import { ProductRepository } from '../catalogue/product/product.repository';
import { CustomerRepository } from '../retail/customer/customer.repository';
import { NetworkRelationshipRepository } from '../retail/network/network-relationship.repository';
import { NetworkRelationshipService } from '../retail/network/network-relationship.service';
import { OutletRepository } from '../retail/outlet/outlet.repository';
import { SalesOrderRepository, SalesOrderWithRelations } from './sales-order.repository';
import { SalesOrderService } from './sales-order.service';

/**
 * Sprint 4.8's central architectural guarantee, verified end to end: a customer never
 * requires a distribution-network relationship to place a Sales Order, and adding one
 * later never rewrites, restricts, or even glances at any historical order.
 *
 * This wires REAL `SalesOrderService`/`NetworkRelationshipService` instances over mocked
 * repositories sharing one in-memory customer/order store — the mocks stand in for the
 * database, but the business logic under test (validation, totals, status transitions,
 * the "no network check" guarantee) is the actual production code, not a stub of it.
 */
describe('Direct sales independence from the distribution network (Sprint 4.8)', () => {
  const customers = new Map<string, Customer>();
  const orders = new Map<string, SalesOrderWithRelations>();
  let orderSequence = 0;

  function makeCustomer(id: string, customerType: CustomerType, name: string): Customer {
    const customer: Customer = {
      id,
      organisationId: 'org-1',
      customerCode: `CUS-${id}`,
      customerType,
      customerName: name,
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
    customers.set(id, customer);
    return customer;
  }

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

  function setup() {
    const customerRepository = {
      findById: jest.fn((organisationId: string, id: string) => {
        const customer = customers.get(id);
        return Promise.resolve(
          customer && customer.organisationId === organisationId ? customer : null,
        );
      }),
    } as unknown as jest.Mocked<CustomerRepository>;

    const outletRepository = {
      findById: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<OutletRepository>;

    const productRepository = {
      findById: jest.fn().mockResolvedValue(finishedProduct),
    } as unknown as jest.Mocked<ProductRepository>;

    const salesOrderRepository = {
      create: jest.fn((data: Record<string, unknown>) => {
        orderSequence += 1;
        const id = `order-${orderSequence}`;
        const order = {
          id,
          organisationId: 'org-1',
          orderCode: `SO-00000${orderSequence}`,
          customerId: (data.customer as { connect: { id: string } }).connect.id,
          outletId: null,
          salesAgentId: data.salesAgentId,
          status: data.status,
          orderDate: data.orderDate,
          notes: data.notes ?? null,
          subtotal: data.subtotal,
          discount: data.discount,
          total: data.total,
          createdById: data.createdById,
          updatedById: data.updatedById,
          createdAt: new Date('2026-08-21'),
          updatedAt: new Date('2026-08-21'),
          customer: {
            id: (data.customer as { connect: { id: string } }).connect.id,
            customerCode: '',
            customerName: '',
          },
          outlet: null,
          items: (
            data.items as {
              create: {
                productId: string;
                quantity: number;
                unitPrice: number;
                lineTotal: number;
              }[];
            }
          ).create.map((item, index) => ({
            id: `item-${orderSequence}-${index}`,
            ...item,
            product: {
              id: item.productId,
              code: finishedProduct.code,
              name: finishedProduct.name,
              unit: finishedProduct.unit,
            },
          })),
        } as unknown as SalesOrderWithRelations;
        orders.set(id, order);
        return Promise.resolve(order);
      }),
      findById: jest.fn((organisationId: string, id: string) => {
        const order = orders.get(id);
        return Promise.resolve(order && order.organisationId === organisationId ? order : null);
      }),
      findManyByOrganisation: jest.fn(),
      existsByCode: jest.fn().mockResolvedValue(false),
      update: jest.fn(),
      updateStatus: jest.fn((organisationId: string, id: string, _fromStatuses, toStatus) => {
        const order = orders.get(id);
        if (!order) return Promise.resolve(null);
        const updated = { ...order, status: toStatus };
        orders.set(id, updated);
        return Promise.resolve(updated);
      }),
    } as unknown as jest.Mocked<SalesOrderRepository>;

    const salesOrderService = new SalesOrderService(
      salesOrderRepository,
      customerRepository,
      outletRepository,
      productRepository,
    );

    const networkRelationshipRepository = {
      create: jest.fn().mockResolvedValue({ id: 'relationship-1', status: 'ACTIVE' }),
      findById: jest.fn(),
      findManyByOrganisation: jest.fn(),
      findActiveDuplicate: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
    } as unknown as jest.Mocked<NetworkRelationshipRepository>;
    const networkRelationshipService = new NetworkRelationshipService(
      networkRelationshipRepository,
      customerRepository,
    );

    return {
      salesOrderService,
      salesOrderRepository,
      networkRelationshipRepository,
      networkRelationshipService,
    };
  }

  it('1. a retailer with no distributor can buy directly — and no network repository is ever consulted', async () => {
    const { salesOrderService, networkRelationshipRepository } = setup();
    makeCustomer('retailer-a', 'RETAILER', 'Retailer A');

    const order = await salesOrderService.create(
      'org-1',
      {
        customerId: 'retailer-a',
        orderDate: new Date('2026-08-21'),
        discount: 0,
        items: [{ productId: 'product-1', quantity: 1, unitPrice: 250 }],
      },
      'sales-agent-1',
    );

    expect(order.customerId).toBe('retailer-a');
    expect(networkRelationshipRepository.findManyByOrganisation).not.toHaveBeenCalled();
    expect(networkRelationshipRepository.findById).not.toHaveBeenCalled();
    expect(networkRelationshipRepository.findActiveDuplicate).not.toHaveBeenCalled();
  });

  it('2-3. a relationship can be added later, and a second order for the same retailer still succeeds', async () => {
    const { salesOrderService, networkRelationshipService, salesOrderRepository } = setup();
    makeCustomer('retailer-a', 'RETAILER', 'Retailer A');
    makeCustomer('distributor-x', 'DISTRIBUTOR', 'Distributor X');

    const firstOrder = await salesOrderService.create(
      'org-1',
      {
        customerId: 'retailer-a',
        orderDate: new Date('2026-08-21'),
        discount: 0,
        items: [{ productId: 'product-1', quantity: 1, unitPrice: 250 }],
      },
      'sales-agent-1',
    );
    const firstOrderSnapshot = JSON.parse(JSON.stringify(firstOrder));

    // Later: Distributor X -> supplies -> Retailer A.
    await expect(
      networkRelationshipService.create(
        'org-1',
        {
          sourceCustomerId: 'distributor-x',
          targetCustomerId: 'retailer-a',
          relationshipType: 'DISTRIBUTES_TO',
        },
        'admin-1',
      ),
    ).resolves.toBeDefined();

    // A second order for Retailer A must still succeed, identically.
    const secondOrder = await salesOrderService.create(
      'org-1',
      {
        customerId: 'retailer-a',
        orderDate: new Date('2026-08-21'),
        discount: 0,
        items: [{ productId: 'product-1', quantity: 3, unitPrice: 250 }],
      },
      'sales-agent-1',
    );
    expect(secondOrder.customerId).toBe('retailer-a');

    // 4. Historical order #1 must remain byte-for-byte unchanged.
    const reread = await salesOrderService.getById('org-1', firstOrder.id);
    expect(JSON.parse(JSON.stringify(reread))).toEqual(firstOrderSnapshot);
    expect(salesOrderRepository.update).not.toHaveBeenCalled();
    expect(salesOrderRepository.updateStatus).not.toHaveBeenCalled();
  });

  describe('5-8. no customer type is ever rejected from buying direct (zero network relationships)', () => {
    const types: CustomerType[] = [
      'DISTRIBUTOR',
      'WHOLESALER',
      'RETAILER',
      'SUPERMARKET',
      'CORPORATE',
      'INSTITUTION',
      'RESTAURANT',
      'HOTEL',
      'OTHER',
    ];

    it.each(types)(
      'a %s can place a direct sales order with no network relationship at all',
      async (customerType) => {
        const { salesOrderService } = setup();
        const id = `customer-${customerType.toLowerCase()}`;
        makeCustomer(id, customerType, `Test ${customerType}`);

        const order = await salesOrderService.create(
          'org-1',
          {
            customerId: id,
            orderDate: new Date('2026-08-21'),
            discount: 0,
            items: [{ productId: 'product-1', quantity: 1, unitPrice: 250 }],
          },
          'sales-agent-1',
        );

        expect(order.customerId).toBe(id);
      },
    );
  });

  it('structural guard: SalesModule never imports NetworkRelationshipModule', () => {
    const salesModuleSource = readFileSync(join(__dirname, 'sales.module.ts'), 'utf-8');
    expect(salesModuleSource).not.toMatch(/from ['"].*retail\/network/);
    // Sprint 4.9: SalesModule now legitimately imports InventoryModule for the
    // SalesFulfilment bridge — see the guard below, which narrows to the one file the
    // "confirmation never touches inventory" guarantee is actually about.
  });

  it('structural guard: SalesOrderService (order create/update/confirm/cancel) never imports Inventory — confirmation still never touches stock (Sprint 4.9)', () => {
    const salesOrderServiceSource = readFileSync(
      join(__dirname, 'sales-order.service.ts'),
      'utf-8',
    );
    expect(salesOrderServiceSource).not.toMatch(/from ['"].*inventory\//);
  });
});
