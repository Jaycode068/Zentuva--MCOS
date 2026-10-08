import { BadRequestException, ForbiddenException } from '@nestjs/common';

import { AuditService } from '../../identity/audit/audit.service';
import { EffectiveAccessResolver } from '../../identity/authorization/effective-access-resolver';
import { OrganisationService } from '../../identity/organisation/organisation.service';
import { PrismaService } from '../../prisma/prisma.service';
import { D2CConversationCapabilityRepository } from './d2c-conversation-capability.repository';
import { D2CConversationConfigService } from './d2c-conversation-config.service';
import { D2CConversationMessageRepository } from './d2c-conversation-message.repository';
import { D2CConversationProfileRepository } from './d2c-conversation-profile.repository';
import { DEFAULT_CAPABILITY_LABELS, DEFAULT_MESSAGES } from './d2c-conversation-config.types';

describe('D2CConversationConfigService', () => {
  const orgId = 'org-1';

  function makeService(grants: Set<string> = new Set(['d2c.conversation.manage'])) {
    const capabilityRepository = {
      findManyByOrganisation: jest.fn().mockResolvedValue([]),
      upsert: jest.fn(),
    } as unknown as jest.Mocked<D2CConversationCapabilityRepository>;
    const messageRepository = {
      findManyByOrganisation: jest.fn().mockResolvedValue([]),
      upsert: jest.fn(),
      delete: jest.fn(),
    } as unknown as jest.Mocked<D2CConversationMessageRepository>;
    const profileRepository = {
      findByOrganisation: jest.fn().mockResolvedValue(null),
      upsert: jest.fn(),
    } as unknown as jest.Mocked<D2CConversationProfileRepository>;
    const organisationService = {
      getById: jest
        .fn()
        .mockResolvedValue({
          id: orgId,
          displayName: null,
          name: 'Boby Bites',
          phone: '0800000000',
          supportEmail: 'help@bobybites.local',
        }),
    } as unknown as jest.Mocked<OrganisationService>;
    const effectiveAccessResolver = {
      resolve: jest.fn().mockResolvedValue({ isOwnerBypass: false, grants }),
    } as unknown as jest.Mocked<EffectiveAccessResolver>;
    const auditService = {
      record: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<AuditService>;
    const prisma = {
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
      d2CConversationCapabilityConfig: { upsert: jest.fn() },
    } as unknown as jest.Mocked<PrismaService>;

    const service = new D2CConversationConfigService(
      prisma,
      capabilityRepository,
      messageRepository,
      profileRepository,
      organisationService,
      effectiveAccessResolver,
      auditService,
    );
    return {
      service,
      capabilityRepository,
      messageRepository,
      profileRepository,
      organisationService,
      effectiveAccessResolver,
      auditService,
      prisma,
    };
  }

  describe('resolveEffectiveConfig — default resolution (no permission check, business-logic read)', () => {
    it('an unconfigured tenant gets every platform default: all capabilities enabled with default labels/order, every message the exact DEFAULT_MESSAGES text', async () => {
      const { service } = makeService();
      const config = await service.resolveEffectiveConfig(orgId);

      expect(config.businessName).toBe('Boby Bites');
      expect(config.supportPhone).toBe('0800000000');
      expect(config.supportEmail).toBe('help@bobybites.local');
      expect(config.capabilities).toHaveLength(6);
      expect(config.capabilities.every((c) => c.enabled)).toBe(true);
      expect(config.capabilities.find((c) => c.capability === 'ORDER_SNACKS')?.displayLabel).toBe(
        DEFAULT_CAPABILITY_LABELS.ORDER_SNACKS,
      );
      expect(config.messages.WELCOME).toBe(DEFAULT_MESSAGES.WELCOME);
      expect(config.messages.HELP).toBe(DEFAULT_MESSAGES.HELP);
    });

    it('a full tenant override replaces the platform default for that field only', async () => {
      const { service, messageRepository } = makeService();
      messageRepository.findManyByOrganisation.mockResolvedValue([
        { organisationId: orgId, messageKey: 'WELCOME', value: 'Welcome to Shop XYZ 🎉' } as never,
      ]);
      const config = await service.resolveEffectiveConfig(orgId);

      expect(config.messages.WELCOME).toBe('Welcome to Shop XYZ 🎉');
      // Every OTHER message is untouched — a single override never corrupts the rest
      // (brief §Phase 19 "field-safe" resolution).
      expect(config.messages.HELP).toBe(DEFAULT_MESSAGES.HELP);
      expect(config.messages.MAIN_MENU_PROMPT).toBe(DEFAULT_MESSAGES.MAIN_MENU_PROMPT);
    });

    it('partial capability override (one disabled, rest default) never disables anything else', async () => {
      const { service, capabilityRepository } = makeService();
      capabilityRepository.findManyByOrganisation.mockResolvedValue([
        {
          organisationId: orgId,
          capability: 'MY_REWARDS',
          enabled: false,
          displayLabel: null,
          sortOrder: 2,
        } as never,
      ]);
      const config = await service.resolveEffectiveConfig(orgId);

      const rewards = config.capabilities.find((c) => c.capability === 'MY_REWARDS');
      expect(rewards?.enabled).toBe(false);
      const others = config.capabilities.filter((c) => c.capability !== 'MY_REWARDS');
      expect(others.every((c) => c.enabled)).toBe(true);
    });

    it('a tenant support phone/email override replaces the Organisation default', async () => {
      const { service, profileRepository } = makeService();
      profileRepository.findByOrganisation.mockResolvedValue({
        organisationId: orgId,
        supportPhoneOverride: '0811111111',
        supportEmailOverride: null,
      } as never);
      const config = await service.resolveEffectiveConfig(orgId);

      expect(config.supportPhone).toBe('0811111111');
      // supportEmail override is null — falls back to the Organisation's own field.
      expect(config.supportEmail).toBe('help@bobybites.local');
    });

    it('a capability label override replaces only the label, never the capability or its enabled state', async () => {
      const { service, capabilityRepository } = makeService();
      capabilityRepository.findManyByOrganisation.mockResolvedValue([
        {
          organisationId: orgId,
          capability: 'ORDER_SNACKS',
          enabled: true,
          displayLabel: '🛍️ Shop Products',
          sortOrder: 0,
        } as never,
      ]);
      const config = await service.resolveEffectiveConfig(orgId);
      const order = config.capabilities.find((c) => c.capability === 'ORDER_SNACKS');
      expect(order?.displayLabel).toBe('🛍️ Shop Products');
      expect(order?.enabled).toBe(true);
    });
  });

  describe('getAdminView — distinguishes customized from default', () => {
    it('marks an unconfigured message/capability as NOT customized, using the platform default value', async () => {
      const { service } = makeService();
      const view = await service.getAdminView(orgId, 'user-1');
      const welcome = view.messages.find((m) => m.messageKey === 'WELCOME')!;
      expect(welcome.isCustomized).toBe(false);
      expect(welcome.value).toBe(DEFAULT_MESSAGES.WELCOME);
      expect(welcome.defaultValue).toBe(DEFAULT_MESSAGES.WELCOME);
    });

    it('marks a configured message as customized, with both its value and the platform default visible', async () => {
      const { service, messageRepository } = makeService();
      messageRepository.findManyByOrganisation.mockResolvedValue([
        { organisationId: orgId, messageKey: 'HELP', value: 'Call us anytime!' } as never,
      ]);
      const view = await service.getAdminView(orgId, 'user-1');
      const help = view.messages.find((m) => m.messageKey === 'HELP')!;
      expect(help.isCustomized).toBe(true);
      expect(help.value).toBe('Call us anytime!');
      expect(help.defaultValue).toBe(DEFAULT_MESSAGES.HELP);
    });

    it('rejects a caller without d2c.conversation.view/.manage', async () => {
      const { service } = makeService(new Set());
      await expect(service.getAdminView(orgId, 'user-1')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getPreview — uses the exact resolver + rendering functions, no second implementation', () => {
    it('returns the welcome message plus the main menu, built from the same effective config', async () => {
      const { service } = makeService();
      const preview = await service.getPreview(orgId, 'user-1');
      expect(preview.messages[0]).toMatchObject({ type: 'BUTTONS' });
      expect((preview.messages[0] as { text: string }).text).toContain('Boby Bites');
      expect(preview.messages[1]).toMatchObject({ type: 'BUTTONS' });
      const menuOptions = (preview.messages[1] as { options: { label: string }[] }).options;
      expect(menuOptions).toHaveLength(6);
    });
  });

  describe('updateCapabilities — validation (brief §Phase 12/25, always server-side)', () => {
    const fullSet = (
      overrides: Partial<{ capability: string; enabled: boolean; sortOrder: number }>[] = [],
    ) => {
      const base = [
        { capability: 'ORDER_SNACKS', enabled: true, sortOrder: 1 },
        { capability: 'MY_ORDERS', enabled: true, sortOrder: 2 },
        { capability: 'MY_REWARDS', enabled: true, sortOrder: 3 },
        { capability: 'MY_ACCOUNT', enabled: true, sortOrder: 4 },
        { capability: 'UPDATE_LOCATION', enabled: true, sortOrder: 5 },
        { capability: 'HELP', enabled: true, sortOrder: 6 },
      ];
      for (const override of overrides) {
        const row = base.find((r) => r.capability === override.capability);
        Object.assign(row!, override);
      }
      return base as never[];
    };

    it('rejects a duplicate capability in the same save', async () => {
      const { service } = makeService();
      const input = [
        { capability: 'ORDER_SNACKS', enabled: true, sortOrder: 1 },
        { capability: 'ORDER_SNACKS', enabled: true, sortOrder: 2 },
      ] as never;
      await expect(service.updateCapabilities(orgId, 'user-1', input)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects a duplicate menu position (sortOrder)', async () => {
      const { service } = makeService();
      const input = fullSet([{ capability: 'MY_ORDERS', sortOrder: 1 }]);
      await expect(service.updateCapabilities(orgId, 'user-1', input)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects disabling every capability — at least one must remain enabled', async () => {
      const { service } = makeService();
      const input = fullSet(
        ['ORDER_SNACKS', 'MY_ORDERS', 'MY_REWARDS', 'MY_ACCOUNT', 'UPDATE_LOCATION', 'HELP'].map(
          (capability) => ({ capability, enabled: false }),
        ),
      );
      await expect(service.updateCapabilities(orgId, 'user-1', input)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('accepts a valid full set — one disabled, the rest enabled, all distinct positions', async () => {
      const { service, prisma } = makeService();
      const input = fullSet([{ capability: 'MY_REWARDS', enabled: false }]);
      await expect(service.updateCapabilities(orgId, 'user-1', input)).resolves.toBeUndefined();
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('rejects a caller without d2c.conversation.manage (view-only is not enough)', async () => {
      const { service } = makeService(new Set(['d2c.conversation.view']));
      const input = fullSet();
      await expect(service.updateCapabilities(orgId, 'user-1', input)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('updateMessage — variable allowlist validation (brief §Phase 9)', () => {
    it('accepts a message using only its own allowed variables', async () => {
      const { service, messageRepository } = makeService();
      await service.updateMessage(orgId, 'user-1', 'WELCOME', 'Hi {{businessName}}, welcome!');
      expect(messageRepository.upsert).toHaveBeenCalledWith(
        orgId,
        'WELCOME',
        'Hi {{businessName}}, welcome!',
      );
    });

    it("rejects a message referencing a variable not in that key's allowlist", async () => {
      const { service } = makeService();
      await expect(
        service.updateMessage(orgId, 'user-1', 'WELCOME', 'Order {{orderCode}} is ready'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an empty message — reset-to-default must be used instead', async () => {
      const { service } = makeService();
      await expect(service.updateMessage(orgId, 'user-1', 'HELP', '   ')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects a caller without d2c.conversation.manage', async () => {
      const { service } = makeService(new Set());
      await expect(
        service.updateMessage(orgId, 'user-1', 'WELCOME', 'Hi {{businessName}}'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('resetMessageToDefault', () => {
    it('deletes the override row — the next resolve falls back to the platform default', async () => {
      const { service, messageRepository } = makeService();
      await service.resetMessageToDefault(orgId, 'user-1', 'WELCOME');
      expect(messageRepository.delete).toHaveBeenCalledWith(orgId, 'WELCOME');
    });
  });

  describe('updateProfile', () => {
    it('rejects a too-short support phone number', async () => {
      const { service } = makeService();
      await expect(service.updateProfile(orgId, 'user-1', { supportPhone: '123' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects an invalid support email', async () => {
      const { service } = makeService();
      await expect(
        service.updateProfile(orgId, 'user-1', { supportEmail: 'not-an-email' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts a valid override and leaves the untouched field alone (passing undefined, not null)', async () => {
      const { service, profileRepository } = makeService();
      await service.updateProfile(orgId, 'user-1', { supportPhone: '0822222222' });
      expect(profileRepository.upsert).toHaveBeenCalledWith(orgId, {
        supportPhoneOverride: '0822222222',
        supportEmailOverride: null,
      });
    });
  });
});
