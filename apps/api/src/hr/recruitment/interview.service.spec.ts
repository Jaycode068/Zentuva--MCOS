import { BadRequestException, NotFoundException } from '@nestjs/common';

import { UserService } from '../../identity/user/user.service';
import { ApplicationRepository } from './application.repository';
import { InterviewRepository } from './interview.repository';
import { InterviewStageRepository } from './interview-stage.repository';
import { InterviewService } from './interview.service';
import { RecruitmentNotificationService } from './recruitment-notification.service';

describe('InterviewService', () => {
  function makeService() {
    const interviewRepository = {
      findById: jest.fn(),
      findByIdWithRelations: jest.fn(),
      listByApplication: jest.fn(),
      listForParticipant: jest.fn(),
      schedule: jest.fn(),
      isParticipant: jest.fn(),
      complete: jest.fn(),
    } as unknown as jest.Mocked<InterviewRepository>;
    const interviewStageRepository = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<InterviewStageRepository>;
    const applicationRepository = {
      findByIdWithRelations: jest.fn(),
      markInterviewing: jest.fn(),
    } as unknown as jest.Mocked<ApplicationRepository>;
    const userService = {
      getById: jest.fn().mockResolvedValue({ id: 'user-1' }),
    } as unknown as jest.Mocked<UserService>;
    const recruitmentNotificationService = {
      notifyInterviewScheduled: jest.fn(),
    } as unknown as jest.Mocked<RecruitmentNotificationService>;
    const service = new InterviewService(
      interviewRepository,
      interviewStageRepository,
      applicationRepository,
      userService,
      recruitmentNotificationService,
    );
    return {
      service,
      interviewRepository,
      interviewStageRepository,
      applicationRepository,
      userService,
      recruitmentNotificationService,
    };
  }

  const application = {
    id: 'app-1',
    vacancyId: 'v-1',
    status: 'SHORTLISTED',
    candidate: { firstName: 'John', lastName: 'Doe' },
    vacancy: { title: 'Cashier' },
  };
  const stage = { id: 'stage-1', vacancyId: 'v-1', name: 'Finance Interview' };
  const scheduleInput = {
    scheduledAt: new Date('2026-10-01T10:00:00Z'),
    participantUserIds: ['user-1', 'user-2'],
  };

  describe('schedule', () => {
    it('404s when the application does not exist', async () => {
      const { service, applicationRepository } = makeService();
      applicationRepository.findByIdWithRelations.mockResolvedValue(null);

      await expect(
        service.schedule('org-1', 'app-1', 'stage-1', scheduleInput as never, 'hr-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects a stage that does not belong to the same vacancy as the application', async () => {
      const { service, applicationRepository, interviewStageRepository } = makeService();
      applicationRepository.findByIdWithRelations.mockResolvedValue(application as never);
      interviewStageRepository.findById.mockResolvedValue({ ...stage, vacancyId: 'v-2' } as never);

      await expect(
        service.schedule('org-1', 'app-1', 'stage-1', scheduleInput as never, 'hr-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects scheduling for a REJECTED/WITHDRAWN application', async () => {
      const { service, applicationRepository, interviewStageRepository } = makeService();
      applicationRepository.findByIdWithRelations.mockResolvedValue({
        ...application,
        status: 'REJECTED',
      } as never);
      interviewStageRepository.findById.mockResolvedValue(stage as never);

      await expect(
        service.schedule('org-1', 'app-1', 'stage-1', scheduleInput as never, 'hr-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an invalid participant user id', async () => {
      const { service, applicationRepository, interviewStageRepository, userService } =
        makeService();
      applicationRepository.findByIdWithRelations.mockResolvedValue(application as never);
      interviewStageRepository.findById.mockResolvedValue(stage as never);
      userService.getById
        .mockResolvedValueOnce({ id: 'user-1' } as never)
        .mockResolvedValueOnce(null);

      await expect(
        service.schedule('org-1', 'app-1', 'stage-1', scheduleInput as never, 'hr-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a duplicate schedule attempt for the same candidate + stage', async () => {
      const { service, applicationRepository, interviewStageRepository, interviewRepository } =
        makeService();
      applicationRepository.findByIdWithRelations.mockResolvedValue(application as never);
      interviewStageRepository.findById.mockResolvedValue(stage as never);
      interviewRepository.schedule.mockResolvedValue(null);

      await expect(
        service.schedule('org-1', 'app-1', 'stage-1', scheduleInput as never, 'hr-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('schedules, marks the application INTERVIEWING, and notifies every participant', async () => {
      const {
        service,
        applicationRepository,
        interviewStageRepository,
        interviewRepository,
        recruitmentNotificationService,
      } = makeService();
      applicationRepository.findByIdWithRelations.mockResolvedValue(application as never);
      interviewStageRepository.findById.mockResolvedValue(stage as never);
      interviewRepository.schedule.mockResolvedValue({
        id: 'interview-1',
        scheduledAt: scheduleInput.scheduledAt,
      } as never);

      const interview = await service.schedule(
        'org-1',
        'app-1',
        'stage-1',
        scheduleInput as never,
        'hr-1',
      );

      expect(interview).toEqual(expect.objectContaining({ id: 'interview-1' }));
      expect(applicationRepository.markInterviewing).toHaveBeenCalledWith('org-1', 'app-1');
      expect(recruitmentNotificationService.notifyInterviewScheduled).toHaveBeenCalledWith(
        expect.objectContaining({
          organisationId: 'org-1',
          interviewId: 'interview-1',
          participantUserIds: ['user-1', 'user-2'],
          candidateName: 'John Doe',
          positionTitle: 'Cashier',
          stageName: 'Finance Interview',
          actionUrl: '/hr-interviews/interview-1',
        }),
      );
    });

    it('de-duplicates repeated participant ids before validating/scheduling', async () => {
      const { service, applicationRepository, interviewStageRepository, interviewRepository } =
        makeService();
      applicationRepository.findByIdWithRelations.mockResolvedValue(application as never);
      interviewStageRepository.findById.mockResolvedValue(stage as never);
      interviewRepository.schedule.mockResolvedValue({
        id: 'interview-1',
        scheduledAt: null,
      } as never);

      await service.schedule(
        'org-1',
        'app-1',
        'stage-1',
        { ...scheduleInput, participantUserIds: ['user-1', 'user-1'] } as never,
        'hr-1',
      );

      expect(interviewRepository.schedule).toHaveBeenCalledWith(
        expect.objectContaining({ participantUserIds: ['user-1'] }),
      );
    });
  });

  describe('isParticipant', () => {
    it('delegates the direct row-check to the repository', async () => {
      const { service, interviewRepository } = makeService();
      interviewRepository.isParticipant.mockResolvedValue(true);

      expect(await service.isParticipant('interview-1', 'user-1')).toBe(true);
      expect(interviewRepository.isParticipant).toHaveBeenCalledWith('interview-1', 'user-1');
    });
  });
});
