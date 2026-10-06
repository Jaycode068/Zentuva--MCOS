import { Request } from 'express';

import { AuditService } from '../../identity/audit/audit.service';
import { TokenPayload } from '../../identity/auth/ports/token.port';
import { LoyaltyController } from './loyalty.controller';
import { LoyaltyService } from './loyalty.service';

describe('LoyaltyController', () => {
  const user: TokenPayload = { sub: 'admin-1', organisationId: 'org-1', sessionId: 'session-1' };
  const req = { ip: '127.0.0.1', headers: { 'user-agent': 'jest' } } as unknown as Request;

  function makeController() {
    const loyaltyService = {
      listAccounts: jest.fn(),
      getAccount: jest.fn(),
      listLedger: jest.fn(),
      adjust: jest.fn(),
    } as unknown as jest.Mocked<LoyaltyService>;
    const auditService = { record: jest.fn() } as unknown as jest.Mocked<AuditService>;
    const controller = new LoyaltyController(loyaltyService, auditService);
    return { controller, loyaltyService, auditService };
  }

  it('getAccount: wraps a null result as { account: null }, not a 404', async () => {
    const { controller, loyaltyService } = makeController();
    loyaltyService.getAccount.mockResolvedValue(null);

    const result = await controller.getAccount('consumer-1', user);
    expect(result).toEqual({ account: null });
  });

  it('adjust: delegates to the service and audits with BALANCE_ADJUSTED, including the reason', async () => {
    const { controller, loyaltyService, auditService } = makeController();
    loyaltyService.adjust.mockResolvedValue({ id: 'entry-1', amount: 100 } as never);

    await controller.adjust('consumer-1', { amount: 100, reason: 'Goodwill' }, user, req);

    expect(loyaltyService.adjust).toHaveBeenCalledWith(
      'org-1',
      'consumer-1',
      { amount: 100, reason: 'Goodwill' },
      'admin-1',
    );
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'loyalty_account.balance_adjusted',
        metadata: expect.objectContaining({ amount: 100, reason: 'Goodwill' }),
      }),
    );
  });

  it('listAccounts: parses pagination defaults', async () => {
    const { controller, loyaltyService } = makeController();
    loyaltyService.listAccounts.mockResolvedValue({ items: [], total: 0 });

    const result = await controller.listAccounts(user);
    expect(result).toEqual({ items: [], total: 0, page: 1, pageSize: 20 });
  });
});
