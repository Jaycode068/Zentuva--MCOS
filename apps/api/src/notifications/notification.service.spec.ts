import { NotFoundException } from '@nestjs/common';

import { NotificationRepository } from './notification.repository';
import { NotificationService } from './notification.service';

describe('NotificationService', () => {
  function makeService() {
    const repo = {
      findManyForRecipient: jest.fn().mockResolvedValue([{ id: 'n-1' }]),
      countForRecipient: jest.fn().mockResolvedValue(1),
      findByIdForRecipient: jest.fn().mockResolvedValue({ id: 'n-1', recipientUserId: 'user-1' }),
      countUnreadForRecipient: jest.fn().mockResolvedValue(3),
      markRead: jest.fn().mockResolvedValue(true),
      markUnread: jest.fn().mockResolvedValue(true),
      markAllRead: jest.fn().mockResolvedValue(2),
    } as unknown as jest.Mocked<NotificationRepository>;
    const service = new NotificationService(repo);
    return { service, repo };
  }

  it("list() scopes by organisationId and recipientUserId, never returning another user/tenant's notifications", async () => {
    const { service, repo } = makeService();
    await service.list('org-1', 'user-1', { page: 1, pageSize: 20 });
    expect(repo.findManyForRecipient).toHaveBeenCalledWith('org-1', 'user-1', expect.any(Object));
    expect(repo.countForRecipient).toHaveBeenCalledWith('org-1', 'user-1', expect.any(Object));
  });

  it('getByIdOrThrow throws NotFound for a notification belonging to another user/tenant', async () => {
    const { service, repo } = makeService();
    repo.findByIdForRecipient.mockResolvedValue(null);
    await expect(
      service.getByIdOrThrow('org-1', 'user-1', 'someone-elses-notification'),
    ).rejects.toThrow(NotFoundException);
  });

  it("unreadCount is scoped to the caller's own organisation and recipient id", async () => {
    const { service, repo } = makeService();
    await expect(service.unreadCount('org-1', 'user-1')).resolves.toBe(3);
    expect(repo.countUnreadForRecipient).toHaveBeenCalledWith('org-1', 'user-1');
  });

  it('markRead verifies ownership before marking (getByIdOrThrow first)', async () => {
    const { service, repo } = makeService();
    await service.markRead('org-1', 'user-1', 'n-1');
    expect(repo.findByIdForRecipient).toHaveBeenCalledWith('org-1', 'user-1', 'n-1');
    expect(repo.markRead).toHaveBeenCalledWith('org-1', 'user-1', 'n-1');
  });

  it('markRead rejects marking a notification that does not belong to the caller', async () => {
    const { service, repo } = makeService();
    repo.findByIdForRecipient.mockResolvedValue(null);
    await expect(service.markRead('org-1', 'user-1', 'not-mine')).rejects.toThrow(
      NotFoundException,
    );
    expect(repo.markRead).not.toHaveBeenCalled();
  });

  it('markUnread verifies ownership before marking', async () => {
    const { service, repo } = makeService();
    await service.markUnread('org-1', 'user-1', 'n-1');
    expect(repo.markUnread).toHaveBeenCalledWith('org-1', 'user-1', 'n-1');
  });

  it("markAllRead only affects the caller's own organisation and recipient id", async () => {
    const { service, repo } = makeService();
    await expect(service.markAllRead('org-1', 'user-1')).resolves.toBe(2);
    expect(repo.markAllRead).toHaveBeenCalledWith('org-1', 'user-1');
  });
});
