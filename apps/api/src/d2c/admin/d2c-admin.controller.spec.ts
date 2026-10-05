import { ForbiddenException } from '@nestjs/common';

import { TokenPayload } from '../../identity/auth/ports/token.port';
import { D2CAdminController } from './d2c-admin.controller';
import { D2CAdminService } from './d2c-admin.service';

describe('D2CAdminController', () => {
  const user: TokenPayload = { sub: 'admin-1', organisationId: 'org-1', sessionId: 'session-1' };

  function makeController() {
    const service = {
      getOverview: jest.fn(),
      getAttention: jest.fn(),
      getTerritorySummary: jest.fn(),
      listConsumers: jest.fn(),
      listOrders: jest.fn(),
    } as unknown as jest.Mocked<D2CAdminService>;
    const controller = new D2CAdminController(service);
    return { controller, service };
  }

  it('getOverview: delegates with organisationId/actorUserId from the token', async () => {
    const { controller, service } = makeController();
    service.getOverview.mockResolvedValue({ summary: {} } as never);

    await controller.getOverview(user);

    expect(service.getOverview).toHaveBeenCalledWith('org-1', 'admin-1');
  });

  it('getOverview: a ForbiddenException from the service propagates untouched', async () => {
    const { controller, service } = makeController();
    service.getOverview.mockRejectedValue(new ForbiddenException('nope'));

    await expect(controller.getOverview(user)).rejects.toThrow(ForbiddenException);
  });

  it('getAttention: wraps the service array as { items }', async () => {
    const { controller, service } = makeController();
    service.getAttention.mockResolvedValue([{ type: 'UNASSIGNED_ORDER' } as never]);

    const result = await controller.getAttention(user);
    expect(result).toEqual({ items: [{ type: 'UNASSIGNED_ORDER' }] });
  });

  it('getTerritorySummary: wraps the service array as { items }', async () => {
    const { controller, service } = makeController();
    service.getTerritorySummary.mockResolvedValue([{ territoryId: 't-1' } as never]);

    const result = await controller.getTerritorySummary(user);
    expect(result).toEqual({ items: [{ territoryId: 't-1' }] });
  });

  it('listConsumers: parses pagination defaults and forwards filters', async () => {
    const { controller, service } = makeController();
    service.listConsumers.mockResolvedValue({ items: [], total: 0 });

    const result = await controller.listConsumers(
      user,
      '2',
      '10',
      'ACTIVE',
      'territory-1',
      ' ada ',
    );

    expect(service.listConsumers).toHaveBeenCalledWith('org-1', 'admin-1', {
      status: 'ACTIVE',
      territoryId: 'territory-1',
      search: 'ada',
      page: 2,
      pageSize: 10,
    });
    expect(result).toEqual({ items: [], total: 0, page: 2, pageSize: 10 });
  });

  it('listOrders: forces no status filter through untouched and converts date strings to Date objects', async () => {
    const { controller, service } = makeController();
    service.listOrders.mockResolvedValue({ items: [], total: 0 });

    await controller.listOrders(
      user,
      undefined,
      undefined,
      undefined,
      'consumer-1',
      'territory-1',
      'outlet-1',
      'PENDING',
      '2026-01-01',
      '2026-01-31',
      'SO-0001',
    );

    expect(service.listOrders).toHaveBeenCalledWith('org-1', 'admin-1', {
      status: undefined,
      consumerId: 'consumer-1',
      consumerTerritoryId: 'territory-1',
      collectionPointOutletId: 'outlet-1',
      paymentStatus: 'PENDING',
      dateFrom: new Date('2026-01-01'),
      dateTo: new Date('2026-01-31'),
      search: 'SO-0001',
      page: 1,
      pageSize: 20,
    });
  });
});
