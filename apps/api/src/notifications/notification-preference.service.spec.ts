import { BadRequestException } from '@nestjs/common';

import { NotificationPreferenceRepository } from './notification-preference.repository';
import { NotificationPreferenceService } from './notification-preference.service';

describe('NotificationPreferenceService', () => {
  function makeService() {
    const repo = {
      findAllForUser: jest.fn().mockResolvedValue([]),
      upsert: jest
        .fn()
        .mockImplementation((organisationId, userId, category, inAppEnabled) =>
          Promise.resolve({ id: 'pref-1', organisationId, userId, category, inAppEnabled }),
        ),
      deleteAllForUser: jest.fn().mockResolvedValue({ count: 2 }),
      findManyForUsers: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<NotificationPreferenceRepository>;
    const service = new NotificationPreferenceService(repo);
    return { service, repo };
  }

  describe('defaults', () => {
    it('returns every category as enabled when no preference rows exist', async () => {
      const { service } = makeService();
      const result = await service.getForUser('org-1', 'user-1');
      expect(result).toEqual([
        { category: 'WORKFLOW_APPROVALS', inAppEnabled: true },
        { category: 'WORKFLOW_STATUS_CHANGES', inAppEnabled: true },
      ]);
    });

    it('reflects a stored override while defaulting the other category', async () => {
      const { service, repo } = makeService();
      repo.findAllForUser.mockResolvedValue([
        {
          id: 'p1',
          organisationId: 'org-1',
          userId: 'user-1',
          category: 'WORKFLOW_APPROVALS',
          inAppEnabled: false,
        },
      ] as never);
      const result = await service.getForUser('org-1', 'user-1');
      expect(result).toEqual([
        { category: 'WORKFLOW_APPROVALS', inAppEnabled: false },
        { category: 'WORKFLOW_STATUS_CHANGES', inAppEnabled: true },
      ]);
    });
  });

  describe('read/update', () => {
    it('reads preferences scoped to the given organisation and user', async () => {
      const { service, repo } = makeService();
      await service.getForUser('org-1', 'user-1');
      expect(repo.findAllForUser).toHaveBeenCalledWith('org-1', 'user-1');
    });

    it('update() upserts scoped to the given organisation and user', async () => {
      const { service, repo } = makeService();
      await service.update('org-1', 'user-1', 'WORKFLOW_APPROVALS', false);
      expect(repo.upsert).toHaveBeenCalledWith('org-1', 'user-1', 'WORKFLOW_APPROVALS', false);
    });

    it('rejects an unsupported category', async () => {
      const { service } = makeService();
      await expect(
        service.update('org-1', 'user-1', 'NOT_A_REAL_CATEGORY' as never, false),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('reset', () => {
    it('deletes all stored overrides for the user, then returns full defaults', async () => {
      const { service, repo } = makeService();
      const result = await service.resetToDefaults('org-1', 'user-1');
      expect(repo.deleteAllForUser).toHaveBeenCalledWith('org-1', 'user-1');
      expect(result.every((p) => p.inAppEnabled)).toBe(true);
    });

    it('reset does not touch any Notification row — only NotificationPreference', async () => {
      const { service, repo } = makeService();
      await service.resetToDefaults('org-1', 'user-1');
      expect(Object.keys(repo)).not.toContain('deleteNotifications');
    });
  });

  describe('filterEnabledRecipients', () => {
    it('excludes a recipient who explicitly disabled the category', async () => {
      const { service, repo } = makeService();
      repo.findManyForUsers.mockResolvedValue([
        {
          id: 'p1',
          organisationId: 'org-1',
          userId: 'user-2',
          category: 'WORKFLOW_APPROVALS',
          inAppEnabled: false,
        },
      ] as never);
      const result = await service.filterEnabledRecipients(
        'org-1',
        ['user-1', 'user-2'],
        'WORKFLOW_APPROVALS',
      );
      expect(result).toEqual(['user-1']);
    });

    it('includes every recipient when nobody has an override', async () => {
      const { service } = makeService();
      const result = await service.filterEnabledRecipients(
        'org-1',
        ['user-1', 'user-2'],
        'WORKFLOW_APPROVALS',
      );
      expect(result).toEqual(['user-1', 'user-2']);
    });

    it('returns an empty list without querying when given zero candidates', async () => {
      const { service, repo } = makeService();
      const result = await service.filterEnabledRecipients('org-1', [], 'WORKFLOW_APPROVALS');
      expect(result).toEqual([]);
      expect(repo.findManyForUsers).not.toHaveBeenCalled();
    });
  });
});
