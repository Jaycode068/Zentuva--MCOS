import { TokenPayload } from '../../identity/auth/ports/token.port';
import { FieldD2COverviewController } from './field-d2c-overview.controller';
import { FieldD2COverviewService } from './field-d2c-overview.service';

describe('FieldD2COverviewController', () => {
  const user: TokenPayload = { sub: 'rep-1', organisationId: 'org-1', sessionId: 'session-1' };

  function makeController() {
    const service = {
      listOrders: jest.fn(),
      listCollectionPoints: jest.fn(),
    } as unknown as jest.Mocked<FieldD2COverviewService>;
    const controller = new FieldD2COverviewController(service);
    return { controller, service };
  }

  it('listOrders: returns { items } wrapping the service result, passing organisationId/actorUserId from the token', async () => {
    const { controller, service } = makeController();
    service.listOrders.mockResolvedValue([{ id: 'so-1' } as never]);

    const result = await controller.listOrders(user);

    expect(result).toEqual({ items: [{ id: 'so-1' }] });
    expect(service.listOrders).toHaveBeenCalledWith('org-1', 'rep-1');
  });

  it('listCollectionPoints: returns { items } wrapping the service result', async () => {
    const { controller, service } = makeController();
    service.listCollectionPoints.mockResolvedValue([{ outletId: 'outlet-1' } as never]);

    const result = await controller.listCollectionPoints(user);

    expect(result).toEqual({ items: [{ outletId: 'outlet-1' }] });
    expect(service.listCollectionPoints).toHaveBeenCalledWith('org-1', 'rep-1');
  });
});
