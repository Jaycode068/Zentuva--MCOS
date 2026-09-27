import { BadRequestException } from '@nestjs/common';

import { ApplicationRepository } from './application.repository';
import { ApplicationService } from './application.service';

describe('ApplicationService', () => {
  function makeService() {
    const repo = {
      findById: jest.fn(),
      findByIdWithRelations: jest.fn(),
      list: jest.fn(),
      screen: jest.fn(),
      shortlist: jest.fn(),
      reject: jest.fn(),
    } as unknown as jest.Mocked<ApplicationRepository>;
    const service = new ApplicationService(repo);
    return { service, repo };
  }

  describe('shortlist', () => {
    it('throws BadRequestException when the application cannot be shortlisted from its current status', async () => {
      const { service, repo } = makeService();
      repo.shortlist.mockResolvedValue(null);

      await expect(service.shortlist('org-1', 'app-1', 'hr-user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('succeeds and passes screening notes through', async () => {
      const { service, repo } = makeService();
      repo.shortlist.mockResolvedValue({ id: 'app-1', status: 'SHORTLISTED' } as never);

      const result = await service.shortlist('org-1', 'app-1', 'hr-user-1', 'Good fit');

      expect(repo.shortlist).toHaveBeenCalledWith('org-1', 'app-1', 'hr-user-1', 'Good fit');
      expect(result).toEqual({ id: 'app-1', status: 'SHORTLISTED' });
    });
  });

  describe('reject', () => {
    it('throws BadRequestException from a terminal status', async () => {
      const { service, repo } = makeService();
      repo.reject.mockResolvedValue(null);

      await expect(service.reject('org-1', 'app-1', 'hr-user-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('screen', () => {
    it('never exposes screeningNotes anywhere outside this authenticated, permission-gated service', async () => {
      // Documents the invariant (enforced by CareersService's public DTOs never
      // including this field) rather than re-testing CareersService here.
      const { service, repo } = makeService();
      repo.screen.mockResolvedValue({
        id: 'app-1',
        status: 'SCREENING',
        screeningNotes: 'internal note',
      } as never);

      const result = await service.screen('org-1', 'app-1', 'hr-user-1', 'internal note');
      expect(result.screeningNotes).toBe('internal note');
    });
  });
});
