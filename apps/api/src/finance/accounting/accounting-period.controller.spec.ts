import { AccountingPeriod, AccountingPeriodStatus } from '@prisma/client';
import { Request } from 'express';

import { AuditService } from '../../identity/audit/audit.service';
import { TokenPayload } from '../../identity/auth/ports/token.port';
import { ACCOUNTING_AUDIT_ACTIONS } from './accounting-audit-actions';
import { AccountingPeriodController } from './accounting-period.controller';
import { AccountingPeriodService } from './accounting-period.service';

describe('AccountingPeriodController', () => {
  const tokenUser: TokenPayload = {
    sub: 'user-1',
    organisationId: 'org-1',
    sessionId: 'session-1',
  };
  const req = { ip: '127.0.0.1', headers: { 'user-agent': 'jest' } } as unknown as Request;

  const period: AccountingPeriod = {
    id: 'period-aug',
    organisationId: 'org-1',
    name: 'August 2026',
    startDate: new Date('2026-08-01'),
    endDate: new Date('2026-08-31'),
    status: AccountingPeriodStatus.OPEN,
    closedAt: null,
    closedById: null,
    createdById: 'user-1',
    createdAt: new Date('2026-08-01'),
    updatedAt: new Date('2026-08-01'),
  };

  function makeController() {
    const accountingPeriodService = {
      list: jest.fn(),
      getById: jest.fn(),
      create: jest.fn(),
      close: jest.fn(),
    } as unknown as jest.Mocked<AccountingPeriodService>;
    const auditService = { record: jest.fn() } as unknown as jest.Mocked<AuditService>;

    const controller = new AccountingPeriodController(accountingPeriodService, auditService);
    return { controller, accountingPeriodService, auditService };
  }

  it('creates a period and records an audit entry', async () => {
    const { controller, accountingPeriodService, auditService } = makeController();
    accountingPeriodService.create.mockResolvedValue(period);

    const result = await controller.create(
      { name: 'August 2026', startDate: new Date('2026-08-01'), endDate: new Date('2026-08-31') },
      tokenUser,
      req,
    );

    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: ACCOUNTING_AUDIT_ACTIONS.ACCOUNTING_PERIOD_CREATED }),
    );
    expect(result.name).toBe('August 2026');
  });

  it('closes a period and records an audit entry', async () => {
    const { controller, accountingPeriodService, auditService } = makeController();
    accountingPeriodService.close.mockResolvedValue({
      ...period,
      status: AccountingPeriodStatus.CLOSED,
    });

    await controller.close('period-aug', tokenUser, req);

    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: ACCOUNTING_AUDIT_ACTIONS.ACCOUNTING_PERIOD_CLOSED }),
    );
  });

  it('lists periods scoped to the caller organisation', async () => {
    const { controller, accountingPeriodService } = makeController();
    accountingPeriodService.list.mockResolvedValue([period]);

    const result = await controller.list(tokenUser);
    expect(accountingPeriodService.list).toHaveBeenCalledWith('org-1');
    expect(result.items).toHaveLength(1);
  });
});
