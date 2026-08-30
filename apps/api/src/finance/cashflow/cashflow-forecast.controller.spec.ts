import { TokenPayload } from '../../identity/auth/ports/token.port';
import { CashflowForecastController } from './cashflow-forecast.controller';
import { CashflowForecastService } from './cashflow-forecast.service';

function makeUser(organisationId: string): TokenPayload {
  return { sub: 'user-1', organisationId, sessionId: 'session-1' };
}

describe('CashflowForecastController', () => {
  function makeController() {
    const cashflowForecastService = {
      getForecast: jest.fn().mockResolvedValue({ buckets: [] }),
      getCashAccountBreakdown: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<CashflowForecastService>;
    return {
      controller: new CashflowForecastController(cashflowForecastService),
      cashflowForecastService,
    };
  }

  it('tenant isolation: the forecast is always scoped by the caller organisation', async () => {
    const { controller, cashflowForecastService } = makeController();
    await controller.getForecast(makeUser('org-2'), '90', 'weekly', undefined, undefined);

    expect(cashflowForecastService.getForecast).toHaveBeenCalledWith(
      'org-2',
      expect.objectContaining({ horizonDays: 90, bucketBy: 'weekly' }),
    );
  });

  it('defaults horizonDays/bucketBy when omitted', async () => {
    const { controller, cashflowForecastService } = makeController();
    await controller.getForecast(makeUser('org-1'));

    expect(cashflowForecastService.getForecast).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ horizonDays: 90, bucketBy: 'weekly' }),
    );
  });

  it('the cash-account breakdown route is tenant-scoped', async () => {
    const { controller, cashflowForecastService } = makeController();
    await controller.getCashAccountBreakdown(makeUser('org-2'), '30');
    expect(cashflowForecastService.getCashAccountBreakdown).toHaveBeenCalledWith('org-2', 30);
  });
});
