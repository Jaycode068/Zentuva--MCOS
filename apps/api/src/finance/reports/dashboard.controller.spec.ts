import { TokenPayload } from '../../identity/auth/ports/token.port';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

function makeUser(organisationId: string): TokenPayload {
  return { sub: 'user-1', organisationId, sessionId: 'session-1' };
}

describe('DashboardController', () => {
  function makeController() {
    const dashboardService = {
      getDashboard: jest.fn().mockResolvedValue({}),
    } as unknown as jest.Mocked<DashboardService>;
    return { controller: new DashboardController(dashboardService), dashboardService };
  }

  it('parses compare=previous_period into a boolean flag', async () => {
    const { controller, dashboardService } = makeController();

    await controller.getDashboard(makeUser('org-1'), '2026-08-01', '2026-08-31', 'previous_period');

    expect(dashboardService.getDashboard).toHaveBeenCalledWith('org-1', {
      from: new Date('2026-08-01'),
      to: new Date('2026-08-31'),
      compare: true,
    });
  });

  it('defaults compare to false when the query param is absent', async () => {
    const { controller, dashboardService } = makeController();

    await controller.getDashboard(makeUser('org-1'));

    expect(dashboardService.getDashboard).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ compare: false }),
    );
  });

  it('tenant isolation: a different caller organisation is passed through unchanged', async () => {
    const { controller, dashboardService } = makeController();

    await controller.getDashboard(makeUser('org-2'));

    expect(dashboardService.getDashboard).toHaveBeenCalledWith('org-2', expect.any(Object));
  });
});
