import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { UserService } from '../../identity/user/user.service';
import { InterviewStageRepository } from './interview-stage.repository';
import { InterviewStageService } from './interview-stage.service';
import { VacancyRepository } from './vacancy.repository';

describe('InterviewStageService', () => {
  function makeService() {
    const repo = {
      findById: jest.fn(),
      listByVacancy: jest.fn(),
      maxSequence: jest.fn(),
      create: jest.fn(),
      replaceParticipants: jest.fn(),
      update: jest.fn(),
    } as unknown as jest.Mocked<InterviewStageRepository>;
    const vacancyRepository = {
      findById: jest.fn().mockResolvedValue({ id: 'v-1' }),
    } as unknown as jest.Mocked<VacancyRepository>;
    const userService = {
      getById: jest.fn(),
    } as unknown as jest.Mocked<UserService>;
    const service = new InterviewStageService(repo, vacancyRepository, userService);
    return { service, repo, vacancyRepository, userService };
  }

  const baseInput = {
    name: 'Finance Interview',
    sequence: 1,
    isRequired: true,
    evaluationRequired: true,
    participantUserIds: ['user-1', 'user-2'],
  };

  describe('create', () => {
    it('404s when the vacancy does not exist', async () => {
      const { service, vacancyRepository } = makeService();
      vacancyRepository.findById.mockResolvedValue(null);

      await expect(service.create('org-1', 'v-1', baseInput as never)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rejects a participant who is not a real user in this organisation', async () => {
      const { service, userService } = makeService();
      userService.getById
        .mockResolvedValueOnce({ id: 'user-1' } as never)
        .mockResolvedValueOnce(null);

      await expect(service.create('org-1', 'v-1', baseInput as never)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('creates the stage once every participant is validated', async () => {
      const { service, repo, userService } = makeService();
      userService.getById.mockResolvedValue({ id: 'user-1' } as never);
      repo.create.mockResolvedValue({ id: 'stage-1' } as never);

      const result = await service.create('org-1', 'v-1', baseInput as never);

      expect(result).toEqual({ id: 'stage-1' });
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ vacancyId: 'v-1', sequence: 1 }),
      );
    });

    it('translates a duplicate-sequence DB conflict into a clear BadRequestException', async () => {
      const { service, repo, userService } = makeService();
      userService.getById.mockResolvedValue({ id: 'user-1' } as never);
      repo.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('duplicate', {
          code: 'P2002',
          clientVersion: 'x',
        }),
      );

      await expect(service.create('org-1', 'v-1', baseInput as never)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('replaceParticipants', () => {
    it('404s when the stage does not exist', async () => {
      const { service, repo } = makeService();
      repo.findById.mockResolvedValue(null);

      await expect(service.replaceParticipants('org-1', 'stage-1', ['user-1'])).rejects.toThrow(
        NotFoundException,
      );
    });

    it('validates every new participant before replacing', async () => {
      const { service, repo, userService } = makeService();
      repo.findById.mockResolvedValue({ id: 'stage-1' } as never);
      userService.getById.mockResolvedValue(null);

      await expect(service.replaceParticipants('org-1', 'stage-1', ['user-x'])).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
