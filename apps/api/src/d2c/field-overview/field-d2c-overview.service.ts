import { Injectable } from '@nestjs/common';
import { CollectionPointFulfillmentStatus } from '@prisma/client';

import { EmployeeService } from '../../hr/employee.service';
import { EffectiveAccessResolver } from '../../identity/authorization/effective-access-resolver';
import { CollectionPointFulfillmentRepository } from '../fulfillment/collection-point-fulfillment.repository';
import { OutletRepository } from '../../retail/outlet/outlet.repository';
import { SalesOrderRepository } from '../../sales/sales-order.repository';
import { FieldD2CCollectionPointResult, FieldD2COrderResult } from './field-d2c-overview.types';

const SALES_CUSTOMER_MANAGE = 'sales.customer.manage';

/**
 * Sprint 38 — Field Operations & Collection Point Mobile Experience
 * (docs/domains/d2c.md). A field Sales Representative's own territory-scoped view of
 * D2C activity — read-only, composed entirely from EXISTING domains
 * (`SalesOrderRepository`, `CollectionPointFulfillmentRepository`, `OutletRepository`).
 * No new order/inventory/Collection Point entity, no new mutation.
 *
 * Territory scoping: this sprint's own audit confirmed no server-side data linked a
 * `User`/`Employee` to a `Territory` anywhere in this codebase (`sales-order
 * .controller.ts`'s own doc comment: "no server-side data links a `User` to a
 * `Territory`" — `AccessScope.ASSIGNED_TERRITORY` is recorded, never enforced). This
 * sprint adds the minimal bridge (`Employee.territoryId`, a plain nullable FK — see its
 * own schema doc comment) and enforces it HERE, server-side, exactly the same
 * "resource-ownership check, not AccessScope" shape
 * `CollectionPointFulfillmentService.getMyOutlets` already established for "my
 * Collection Point": an admin (`isOwnerBypass` or `sales.customer.manage`) sees
 * everything tenant-wide; anyone else sees only their own `Employee.territoryId`'s
 * D2C orders/Collection Points; a caller with no territory assigned sees nothing
 * (deny-by-default, never falls back to unrestricted).
 */
@Injectable()
export class FieldD2COverviewService {
  constructor(
    private readonly salesOrderRepository: SalesOrderRepository,
    private readonly collectionPointFulfillmentRepository: CollectionPointFulfillmentRepository,
    private readonly outletRepository: OutletRepository,
    private readonly employeeService: EmployeeService,
    private readonly effectiveAccessResolver: EffectiveAccessResolver,
  ) {}

  async listOrders(organisationId: string, actorUserId: string): Promise<FieldD2COrderResult[]> {
    const territoryId = await this.resolveTerritoryScope(organisationId, actorUserId);
    if (territoryId === 'NONE') {
      return [];
    }

    const orders = await this.salesOrderRepository.findManyByOrganisation(organisationId, {
      source: 'D2C',
      ...(territoryId === 'ALL' ? {} : { consumerTerritoryId: territoryId }),
    });
    if (orders.length === 0) {
      return [];
    }

    const fulfillments = await this.collectionPointFulfillmentRepository.findManyBySalesOrderIds(
      organisationId,
      orders.map((order) => order.id),
    );
    const fulfillmentByOrderId = new Map(fulfillments.map((f) => [f.salesOrderId, f]));

    return orders.map((order) => {
      const fulfillment = fulfillmentByOrderId.get(order.id) ?? null;
      return {
        id: order.id,
        orderCode: order.orderCode,
        orderDate: order.orderDate,
        total: order.total,
        status: order.status,
        consumer: order.consumer
          ? {
              name: order.consumer.fullName,
              territoryName: order.consumer.territory?.name ?? null,
            }
          : null,
        collectionPoint: fulfillment
          ? {
              outletId: fulfillment.outletId,
              outletName: fulfillment.outlet.name,
              fulfillmentStatus: fulfillment.status,
              assignedAt: fulfillment.assignedAt,
            }
          : null,
      };
    });
  }

  async listCollectionPoints(
    organisationId: string,
    actorUserId: string,
  ): Promise<FieldD2CCollectionPointResult[]> {
    const territoryId = await this.resolveTerritoryScope(organisationId, actorUserId);
    if (territoryId === 'NONE') {
      return [];
    }

    const outlets = await this.outletRepository.findManyByOrganisation(organisationId, {
      collectionPointStatus: 'ENABLED',
      ...(territoryId === 'ALL' ? {} : { territoryId }),
    });
    if (outlets.length === 0) {
      return [];
    }

    return Promise.all(
      outlets.map(async (outlet) => {
        const queue = await this.collectionPointFulfillmentRepository.findManyByOutlet(
          organisationId,
          outlet.id,
          [
            CollectionPointFulfillmentStatus.ASSIGNED,
            CollectionPointFulfillmentStatus.PREPARING,
            CollectionPointFulfillmentStatus.READY_FOR_COLLECTION,
          ],
        );
        return {
          outletId: outlet.id,
          outletName: outlet.name,
          territoryName: outlet.territory?.name ?? null,
          collectionPointStatus: outlet.collectionPointStatus,
          responsibleUserId: outlet.collectionPointResponsibleUserId,
          operatingHours: outlet.collectionPointOperatingHours,
          ordersAwaitingFulfilment: queue.filter(
            (q) =>
              q.status === CollectionPointFulfillmentStatus.ASSIGNED ||
              q.status === CollectionPointFulfillmentStatus.PREPARING,
          ).length,
          ordersReadyForCollection: queue.filter(
            (q) => q.status === CollectionPointFulfillmentStatus.READY_FOR_COLLECTION,
          ).length,
        };
      }),
    );
  }

  /** Returns `'ALL'` for an admin (tenant-wide visibility), a real territory id for a
   *  scoped field rep, or `'NONE'` when the caller is neither an admin nor has a
   *  territory assigned — deny-by-default, never falls back to unrestricted. */
  private async resolveTerritoryScope(
    organisationId: string,
    actorUserId: string,
  ): Promise<string | 'ALL' | 'NONE'> {
    const access = await this.effectiveAccessResolver.resolve(organisationId, actorUserId);
    if (access.isOwnerBypass || access.grants.has(SALES_CUSTOMER_MANAGE)) {
      return 'ALL';
    }
    const employee = await this.employeeService.getByUserId(organisationId, actorUserId);
    if (!employee?.territoryId) {
      return 'NONE';
    }
    return employee.territoryId;
  }
}
