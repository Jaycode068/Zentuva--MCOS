import { BadRequestException } from '@nestjs/common';
import { Request } from 'express';

import { AuditService } from '../../identity/audit/audit.service';
import { TokenPayload } from '../../identity/auth/ports/token.port';
import { PromotionController } from './promotion.controller';
import { PromotionService } from './promotion.service';
import { PromotionNotEditableError } from './promotion.types';

describe('PromotionController', () => {
  const user: TokenPayload = { sub: 'user-1', organisationId: 'org-1', sessionId: 'session-1' };
  const req = { ip: '127.0.0.1', headers: { 'user-agent': 'jest' } } as unknown as Request;

  const promotion = {
    id: 'promo-1',
    name: 'First Order October',
    description: null,
    status: 'DRAFT',
    startsAt: new Date('2026-10-01'),
    endsAt: new Date('2026-10-31'),
    activatedAt: null,
    conditions: [],
    benefits: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  function makeController() {
    const promotionService = {
      list: jest.fn(),
      getById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      activate: jest.fn(),
      pause: jest.fn(),
      resume: jest.fn(),
    } as unknown as jest.Mocked<PromotionService>;
    const auditService = { record: jest.fn() } as unknown as jest.Mocked<AuditService>;
    const controller = new PromotionController(promotionService, auditService);
    return { controller, promotionService, auditService };
  }

  it('list: parses pagination defaults and wraps the service result', async () => {
    const { controller, promotionService } = makeController();
    promotionService.list.mockResolvedValue({ items: [promotion as never], total: 1 });

    const result = await controller.list(user);

    expect(result).toEqual({
      items: [expect.objectContaining({ id: 'promo-1' })],
      total: 1,
      page: 1,
      pageSize: 20,
    });
  });

  it('create: audits with the CREATED action and returns the mapped promotion', async () => {
    const { controller, promotionService, auditService } = makeController();
    promotionService.create.mockResolvedValue(promotion as never);

    const result = await controller.create(
      {
        name: 'First Order October',
        startsAt: new Date('2026-10-01'),
        endsAt: new Date('2026-10-31'),
        conditions: [],
      },
      user,
      req,
    );

    expect(result.id).toBe('promo-1');
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'promotion.created' }),
    );
  });

  it('update: maps PromotionNotEditableError to 400', async () => {
    const { controller, promotionService } = makeController();
    promotionService.update.mockRejectedValue(
      new PromotionNotEditableError('cannot edit an activated promotion'),
    );

    await expect(controller.update('promo-1', {}, user, req)).rejects.toThrow(BadRequestException);
  });

  it('activate: audits with the ACTIVATED action', async () => {
    const { controller, promotionService, auditService } = makeController();
    promotionService.activate.mockResolvedValue({ ...promotion, status: 'ACTIVE' } as never);

    const result = await controller.activate('promo-1', user, req);

    expect(result.status).toBe('ACTIVE');
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'promotion.activated' }),
    );
  });

  it('pause: audits with the PAUSED action', async () => {
    const { controller, promotionService, auditService } = makeController();
    promotionService.pause.mockResolvedValue({ ...promotion, status: 'PAUSED' } as never);

    await controller.pause('promo-1', user, req);

    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'promotion.paused' }),
    );
  });

  it('resume: audits with the RESUMED action', async () => {
    const { controller, promotionService, auditService } = makeController();
    promotionService.resume.mockResolvedValue({ ...promotion, status: 'ACTIVE' } as never);

    await controller.resume('promo-1', user, req);

    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'promotion.resumed' }),
    );
  });
});
