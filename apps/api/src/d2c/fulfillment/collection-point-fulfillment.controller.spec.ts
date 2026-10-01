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
      startPreparing: jest.fn(),
      markReadyForCollection: jest.fn(),
      confirmCollection: jest.fn(),
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
});
