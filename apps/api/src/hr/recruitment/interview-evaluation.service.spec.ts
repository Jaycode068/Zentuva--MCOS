import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

import { UserService } from '../../identity/user/user.service';
import { InterviewEvaluationRepository } from './interview-evaluation.repository';
import { InterviewEvaluationService } from './interview-evaluation.service';
import { InterviewRepository } from './interview.repository';

describe('InterviewEvaluationService', () => {
  function makeService() {
    const evaluationRepository = {
      findByInterviewAndEvaluator: jest.fn(),
      listByInterview: jest.fn(),
      create: jest.fn(),
      findById: jest.fn(),
      markReopened: jest.fn(),
    } as unknown as jest.Mocked<InterviewEvaluationRepository>;
    const interviewRepository = {
      findById: jest.fn(),
      isParticipant: jest.fn(),
    } as unknown as jest.Mocked<InterviewRepository>;
    const userService = {
      getById: jest.fn().mockResolvedValue({ id: 'user-1', status: 'ACTIVE' }),
    } as unknown as jest.Mocked<UserService>;
    const service = new InterviewEvaluationService(
      evaluationRepository,
      interviewRepository,
      userService,
    );
    return { service, evaluationRepository, interviewRepository, userService };
  }

  const submitInput = { score: 4, recommendation: 'PROCEED', comments: 'Solid candidate' };

  describe('submit — interviewer authorization (recruitment.md "Interviewer Authorization")', () => {
    it('404s when the interview does not exist', async () => {
      const { service, interviewRepository } = makeService();
      interviewRepository.findById.mockResolvedValue(null);

      await expect(
        service.submit('org-1', 'interview-1', 'user-unassigned', submitInput as never),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects an evaluator who is NOT an assigned participant — server-side, never trusting the frontend', async () => {
      const { service, interviewRepository } = makeService();
      interviewRepository.findById.mockResolvedValue({ id: 'interview-1' } as never);
      interviewRepository.isParticipant.mockResolvedValue(false);

      await expect(
        service.submit('org-1', 'interview-1', 'user-unassigned', submitInput as never),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows an assigned participant to submit', async () => {
      const { service, interviewRepository, evaluationRepository } = makeService();
      interviewRepository.findById.mockResolvedValue({ id: 'interview-1' } as never);
      interviewRepository.isParticipant.mockResolvedValue(true);
      evaluationRepository.create.mockResolvedValue({ id: 'eval-1' } as never);

      const result = await service.submit('org-1', 'interview-1', 'user-1', submitInput as never);

      expect(result).toEqual({ id: 'eval-1' });
      expect(evaluationRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ evaluatorUserId: 'user-1', score: 4, recommendation: 'PROCEED' }),
      );
    });

    it('rejects a suspended interviewer even though they are an assigned participant (brief §50 "a suspended interviewer cannot perform a new evaluation" — JwtAuthGuard alone does not re-verify live status)', async () => {
      const { service, interviewRepository, evaluationRepository, userService } = makeService();
      interviewRepository.findById.mockResolvedValue({ id: 'interview-1' } as never);
      interviewRepository.isParticipant.mockResolvedValue(true);
      userService.getById.mockResolvedValue({ id: 'user-1', status: 'INACTIVE' } as never);

      await expect(
        service.submit('org-1', 'interview-1', 'user-1', submitInput as never),
      ).rejects.toThrow(ForbiddenException);
      expect(evaluationRepository.create).not.toHaveBeenCalled();
    });

    it('rejects when the evaluator user no longer exists', async () => {
      const { service, interviewRepository, evaluationRepository, userService } = makeService();
      interviewRepository.findById.mockResolvedValue({ id: 'interview-1' } as never);
      interviewRepository.isParticipant.mockResolvedValue(true);
      userService.getById.mockResolvedValue(null);

      await expect(
        service.submit('org-1', 'interview-1', 'user-1', submitInput as never),
      ).rejects.toThrow(ForbiddenException);
      expect(evaluationRepository.create).not.toHaveBeenCalled();
    });
  });

  describe('submit — duplicate/immutability guard', () => {
    it('throws when the evaluator has already submitted (DB-unique-constraint-backed)', async () => {
      const { service, interviewRepository, evaluationRepository } = makeService();
      interviewRepository.findById.mockResolvedValue({ id: 'interview-1' } as never);
      interviewRepository.isParticipant.mockResolvedValue(true);
      evaluationRepository.create.mockResolvedValue(null);

      await expect(
        service.submit('org-1', 'interview-1', 'user-1', submitInput as never),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getOwnEvaluation — independence (recruitment.md "Independent Evaluation Privacy")', () => {
    it('rejects a non-participant entirely (never leaks even the absence-vs-presence of an evaluation)', async () => {
      const { service, interviewRepository } = makeService();
      interviewRepository.isParticipant.mockResolvedValue(false);

      await expect(
        service.getOwnEvaluation('org-1', 'interview-1', 'user-unassigned'),
      ).rejects.toThrow(ForbiddenException);
    });

    it("returns only the caller's own evaluation (null if not yet submitted), never another participant's", async () => {
      const { service, interviewRepository, evaluationRepository } = makeService();
      interviewRepository.isParticipant.mockResolvedValue(true);
      evaluationRepository.findByInterviewAndEvaluator.mockResolvedValue(null);

      const result = await service.getOwnEvaluation('org-1', 'interview-1', 'user-1');

      expect(result).toBeNull();
      expect(evaluationRepository.findByInterviewAndEvaluator).toHaveBeenCalledWith(
        'interview-1',
        'user-1',
      );
    });
  });

  describe('reopen', () => {
    it('404s when the evaluation does not exist or is already reopened', async () => {
      const { service, evaluationRepository } = makeService();
      evaluationRepository.markReopened.mockResolvedValue(null);

      await expect(service.reopen('org-1', 'eval-1')).rejects.toThrow(NotFoundException);
    });

    it('marks reopenedAt/reopenedByUserId without touching the original score/recommendation', async () => {
      const { service, evaluationRepository } = makeService();
      evaluationRepository.markReopened.mockResolvedValue({
        id: 'eval-1',
        score: 4,
        recommendation: 'PROCEED',
        reopenedAt: new Date(),
      } as never);

      const result = await service.reopen('org-1', 'eval-1');
      expect(result.score).toBe(4);
      expect(result.recommendation).toBe('PROCEED');
      expect(result.reopenedAt).not.toBeNull();
    });
  });
});
