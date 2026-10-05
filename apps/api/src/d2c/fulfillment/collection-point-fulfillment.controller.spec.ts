import { BadRequestException, ForbiddenException } from '@nestjs/common';

import { TokenPayload } from '../../identity/auth/ports/token.port';
import { CollectionPointFulfillmentController } from './collection-point-fulfillment.controller';
import { CollectionPointFulfillmentService } from './collection-point-fulfillment.service';
import {
  AlreadyAssignedError,
  NoEligibleCollectionPointError,
  NotAuthorizedForCollectionPointError,
} from './collection-point-fulfillment.types';

describe('CollectionPointFulfillmentController', () => {
  const user: TokenPayload = { sub: 'rep-1', organisationId: 'org-1', sessionId: 'session-1' };

  function makeController() {
    const service = {
      assignManually: jest.fn(),
      getQueueForOutlet: jest.fn(),
      getMyOutlets: jest.fn(),
      getById: jest.fn(),
      getInventoryViewForOutlet: jest.fn(),
      startPreparing: jest.fn(),
      markReadyForCollection: jest.fn(),
      confirmCollection: jest.fn(),
      listAll: jest.fn(),
      getBySalesOrderId: jest.fn(),
      reassign: jest.fn(),
      listEligibleOutletsForReassignment: jest.fn(),
    } as unknown as jest.Mocked<CollectionPointFulfillmentService>;
    const controller = new CollectionPointFulfillmentController(service);
    return { controller, service };
  }

  it('assign: delegates with organisationId/actorUserId from the token, never the body', async () => {
    const { controller, service } = makeController();
    service.assignManually.mockResolvedValue({} as never);

    await controller.assign({ salesOrderId: 'so-1', outletId: 'outlet-1' }, user);

    expect(service.assignManually).toHaveBeenCalledWith('org-1', 'so-1', 'outlet-1', 'rep-1');
  });

  it('assign: maps NoEligibleCollectionPointError to 400', async () => {
    const { controller, service } = makeController();
    service.assignManually.mockRejectedValue(new NoEligibleCollectionPointError('none'));

    await expect(controller.assign({ salesOrderId: 'so-1' }, user)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('assign: maps AlreadyAssignedError to 400', async () => {
    const { controller, service } = makeController();
    service.assignManually.mockRejectedValue(new AlreadyAssignedError('already'));

    await expect(controller.assign({ salesOrderId: 'so-1' }, user)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('confirmCollection: maps NotAuthorizedForCollectionPointError to 403', async () => {
    const { controller, service } = makeController();
    service.confirmCollection.mockRejectedValue(new NotAuthorizedForCollectionPointError('nope'));

    await expect(controller.confirmCollection('cpf-1', user)).rejects.toThrow(ForbiddenException);
  });

  it('getMyOutlets: returns { items } wrapping the service result', async () => {
    const { controller, service } = makeController();
    service.getMyOutlets.mockResolvedValue([{ id: 'outlet-1', name: 'Bodija Supermart' }]);

    const result = await controller.getMyOutlets(user);
    expect(result).toEqual({ items: [{ id: 'outlet-1', name: 'Bodija Supermart' }] });
    expect(service.getMyOutlets).toHaveBeenCalledWith('org-1', 'rep-1');
  });

  it('getQueue: returns { items } wrapping the service result', async () => {
    const { controller, service } = makeController();
    service.getQueueForOutlet.mockResolvedValue([{ id: 'cpf-1' } as never]);

    const result = await controller.getQueue('outlet-1', user);
    expect(result).toEqual({ items: [{ id: 'cpf-1' }] });
    expect(service.getQueueForOutlet).toHaveBeenCalledWith('org-1', 'outlet-1', 'rep-1');
  });

  it('getInventoryView: returns { items } wrapping the service result', async () => {
    const { controller, service } = makeController();
    service.getInventoryViewForOutlet.mockResolvedValue([
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

    const result = await controller.getInventoryView('outlet-1', user);
    expect(result).toEqual({
      items: [expect.objectContaining({ productId: 'product-1', status: 'SUFFICIENT' })],
    });
    expect(service.getInventoryViewForOutlet).toHaveBeenCalledWith('org-1', 'outlet-1', 'rep-1');
  });

  it('getInventoryView: maps NotAuthorizedForCollectionPointError-equivalent rejection to 403 via the shared error mapper', async () => {
    const { controller, service } = makeController();
    service.getInventoryViewForOutlet.mockRejectedValue(
      new NotAuthorizedForCollectionPointError('nope'),
    );

    await expect(controller.getInventoryView('outlet-1', user)).rejects.toThrow(ForbiddenException);
  });

  it('startPreparing / markReady / confirmCollection: all pass organisationId/id/actorUserId through', async () => {
    const { controller, service } = makeController();
    service.startPreparing.mockResolvedValue({} as never);
    service.markReadyForCollection.mockResolvedValue({} as never);
    service.confirmCollection.mockResolvedValue({} as never);

    await controller.startPreparing('cpf-1', user);
    await controller.markReady('cpf-1', user);
    await controller.confirmCollection('cpf-1', user);

    expect(service.startPreparing).toHaveBeenCalledWith('org-1', 'cpf-1', 'rep-1');
    expect(service.markReadyForCollection).toHaveBeenCalledWith('org-1', 'cpf-1', 'rep-1');
    expect(service.confirmCollection).toHaveBeenCalledWith('org-1', 'cpf-1', 'rep-1');
  });

  /** Added Sprint 39 — the D2C Admin's org-wide Collection Point summary. */
  it('listAll: parses pagination defaults and wraps the service result with page/pageSize', async () => {
    const { controller, service } = makeController();
    service.listAll.mockResolvedValue({ items: [{ id: 'cpf-1' } as never], total: 1 });

    const result = await controller.listAll(user);

    expect(result).toEqual({ items: [{ id: 'cpf-1' }], total: 1, page: 1, pageSize: 20 });
    expect(service.listAll).toHaveBeenCalledWith(
      'org-1',
      'rep-1',
      expect.objectContaining({ page: 1, pageSize: 20 }),
    );
  });

  it('listAll: maps a ForbiddenException from the service straight through', async () => {
    const { controller, service } = makeController();
    service.listAll.mockRejectedValue(new ForbiddenException('nope'));

    await expect(controller.listAll(user)).rejects.toThrow(ForbiddenException);
  });

  /** Added Sprint 39 — the D2C Admin Order Detail page's collection-status lookup. */
  it('getBySalesOrder: wraps a null result as { item: null }, not a 404', async () => {
    const { controller, service } = makeController();
    service.getBySalesOrderId.mockResolvedValue(null);

    const result = await controller.getBySalesOrder('so-1', user);
    expect(result).toEqual({ item: null });
  });

  /** Added Sprint 39 — the admin-only reassignment override. */
  it('reassign: delegates with organisationId/id/outletId/actorUserId from the token+body', async () => {
    const { controller, service } = makeController();
    service.reassign.mockResolvedValue({} as never);

    await controller.reassign('cpf-1', { outletId: 'outlet-2' }, user);

    expect(service.reassign).toHaveBeenCalledWith('org-1', 'cpf-1', 'outlet-2', 'rep-1');
  });

  it('reassign: maps a BadRequestException from the service straight through', async () => {
    const { controller, service } = makeController();
    service.reassign.mockRejectedValue(new BadRequestException('already there'));

    await expect(controller.reassign('cpf-1', { outletId: 'outlet-2' }, user)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('getEligibleForReassignment: returns { items } wrapping the service result', async () => {
    const { controller, service } = makeController();
    service.listEligibleOutletsForReassignment.mockResolvedValue([
      { id: 'outlet-1', name: 'Bodija Supermart' },
    ]);

    const result = await controller.getEligibleForReassignment(user);
    expect(result).toEqual({ items: [{ id: 'outlet-1', name: 'Bodija Supermart' }] });
  });
});
