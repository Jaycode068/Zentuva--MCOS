import { TokenPayload } from '../../identity/auth/ports/token.port';
import { RevenueCogsController } from './revenue-cogs.controller';
import { RevenueCogsService } from './revenue-cogs.service';

function makeUser(organisationId: string): TokenPayload {
  return { sub: 'user-1', organisationId, sessionId: 'session-1' };
}

describe('RevenueCogsController', () => {
  function makeController() {
    const revenueCogsService = {
      getRevenueReport: jest.fn().mockResolvedValue({ totalRevenue: 0 }),
      getCogsReport: jest.fn().mockResolvedValue({ totalCogs: 0 }),
    } as unknown as jest.Mocked<RevenueCogsService>;
    return { controller: new RevenueCogsController(revenueCogsService), revenueCogsService };
  }

  it('getRevenue scopes to the caller organisation with parsed dates', async () => {
    const { controller, revenueCogsService } = makeController();

    await controller.getRevenue(makeUser('org-1'), '2026-08-01', '2026-08-31');

    expect(revenueCogsService.getRevenueReport).toHaveBeenCalledWith('org-1', {
      from: new Date('2026-08-01'),
      to: new Date('2026-08-31'),
    });
  });

  it('getCogs scopes to the caller organisation with parsed dates', async () => {
    const { controller, revenueCogsService } = makeController();

    await controller.getCogs(makeUser('org-1'), '2026-08-01', '2026-08-31');

    expect(revenueCogsService.getCogsReport).toHaveBeenCalledWith('org-1', {
      from: new Date('2026-08-01'),
      to: new Date('2026-08-31'),
    });
  });

  it('tenant isolation: a different caller organisation is passed through unchanged', async () => {
    const { controller, revenueCogsService } = makeController();

    await controller.getRevenue(makeUser('org-2'));

    expect(revenueCogsService.getRevenueReport).toHaveBeenCalledWith('org-2', expect.any(Object));
  });
});
