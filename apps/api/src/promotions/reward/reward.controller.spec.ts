import { TokenPayload } from '../../identity/auth/ports/token.port';
import { RewardController } from './reward.controller';
import { RewardGrantService } from './reward-grant.service';

describe('RewardController', () => {
  const user: TokenPayload = { sub: 'admin-1', organisationId: 'org-1', sessionId: 'session-1' };

  function makeController() {
    const rewardGrantService = {
      list: jest.fn(),
      listForConsumer: jest.fn(),
    } as unknown as jest.Mocked<RewardGrantService>;
    const controller = new RewardController(rewardGrantService);
    return { controller, rewardGrantService };
  }

  it('list: parses pagination defaults and forwards promotionId', async () => {
    const { controller, rewardGrantService } = makeController();
    rewardGrantService.list.mockResolvedValue({ items: [], total: 0 });

    const result = await controller.list(user, undefined, undefined, 'promo-1');

    expect(rewardGrantService.list).toHaveBeenCalledWith('org-1', {
      promotionId: 'promo-1',
      page: 1,
      pageSize: 20,
    });
    expect(result).toEqual({ items: [], total: 0, page: 1, pageSize: 20 });
  });

  it('listForConsumer: delegates with the consumer id', async () => {
    const { controller, rewardGrantService } = makeController();
    rewardGrantService.listForConsumer.mockResolvedValue({ items: [], total: 0 });

    await controller.listForConsumer('consumer-1', user);

    expect(rewardGrantService.listForConsumer).toHaveBeenCalledWith('org-1', 'consumer-1', {
      page: 1,
      pageSize: 20,
    });
  });
});
