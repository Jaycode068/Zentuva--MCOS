import { TokenPayload } from '../../identity/auth/ports/token.port';
import { CashflowSettingsController } from './cashflow-settings.controller';
import { CashflowSettingsService } from './cashflow-settings.service';

function makeUser(organisationId: string): TokenPayload {
  return { sub: 'user-1', organisationId, sessionId: 'session-1' };
}

const SETTINGS = {
  minimumCashReserve: 5_000_000,
  defaultCollectionDelayDays: 0,
  defaultPaymentDelayDays: 0,
};

describe('CashflowSettingsController', () => {
  function makeController() {
    const cashflowSettingsService = {
      getEffective: jest.fn().mockResolvedValue(SETTINGS),
      update: jest.fn().mockResolvedValue({ ...SETTINGS, minimumCashReserve: 10_000_000 }),
    } as unknown as jest.Mocked<CashflowSettingsService>;
    const auditService = { record: jest.fn() };
    return {
      controller: new CashflowSettingsController(cashflowSettingsService, auditService as never),
      cashflowSettingsService,
      auditService,
    };
  }

  it('tenant isolation: GET is scoped by the caller organisation', async () => {
    const { controller, cashflowSettingsService } = makeController();
    await controller.getSettings(makeUser('org-2'));
    expect(cashflowSettingsService.getEffective).toHaveBeenCalledWith('org-2');
  });

  it('update audits cashflow.settings.updated with the new values', async () => {
    const { controller, auditService } = makeController();
    await controller.update({ minimumCashReserve: 10_000_000 }, makeUser('org-1'), {
      ip: '',
      headers: {},
    } as never);

    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'cashflow.settings.updated',
        organisationId: 'org-1',
      }),
    );
  });
});
