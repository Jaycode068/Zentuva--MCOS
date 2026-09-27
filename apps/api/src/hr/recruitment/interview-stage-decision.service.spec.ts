import { BadRequestException, NotFoundException } from '@nestjs/common';

import { ApplicationRepository } from './application.repository';
import { InterviewEvaluationRepository } from './interview-evaluation.repository';
import { InterviewRepository } from './interview.repository';
import { InterviewStageDecisionRepository } from './interview-stage-decision.repository';
import { InterviewStageDecisionService } from './interview-stage-decision.service';
import { InterviewStageRepository } from './interview-stage.repository';

describe('InterviewStageDecisionService', () => {
  function makeService() {
    const decisionRepository = {
      listByInterview: jest.fn(),
      record: jest.fn(),
    } as unknown as jest.Mocked<InterviewStageDecisionRepository>;
    const interviewRepository = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<InterviewRepository>;
    const evaluationRepository = {
      listByInterview: jest.fn(),
    } as unknown as jest.Mocked<InterviewEvaluationRepository>;
    const interviewStageRepository = {
      findById: jest.fn(),
      maxSequence: jest.fn(),
    } as unknown as jest.Mocked<InterviewStageRepository>;
    const applicationRepository = {
      reject: jest.fn(),
      setStatus: jest.fn(),
    } as unknown as jest.Mocked<ApplicationRepository>;
    const service = new InterviewStageDecisionService(
      decisionRepository,
      interviewRepository,
      evaluationRepository,
      interviewStageRepository,
      applicationRepository,
    );
    return {
      service,
      decisionRepository,
      interviewRepository,
      evaluationRepository,
      interviewStageRepository,
      applicationRepository,
    };
  }

  describe('summarize — evidence only, brief §"No Automatic Hiring Decision"', () => {
    it('computes average score and recommendation counts, never a pass/fail verdict', async () => {
      const { service, interviewRepository, evaluationRepository } = makeService();
      interviewRepository.findById.mockResolvedValue({
        id: 'interview-1',
        participants: [{ userId: 'u1' }, { userId: 'u2' }, { userId: 'u3' }],
      } as never);
      evaluationRepository.listByInterview.mockResolvedValue([
        { score: 4, recommendation: 'PROCEED' },
        { score: 4, recommendation: 'PROCEED' },
        { score: 3, recommendation: 'HOLD' },
      ] as never);

      const summary = await service.summarize('org-1', 'interview-1');

      expect(summary).toEqual({
        evaluatorsAssigned: 3,
        evaluationsCompleted: 3,
        averageScore: 3.7,
        recommendationCounts: { PROCEED: 2, HOLD: 1 },
      });
      // The summary object itself carries no "result"/"decision"/"passed" field —
      // nothing here is a verdict, only counts and an average.
      expect(summary).not.toHaveProperty('result');
      expect(summary).not.toHaveProperty('passed');
    });

    it('reports null average with zero completed evaluations, never divides by zero', async () => {
      const { service, interviewRepository, evaluationRepository } = makeService();
      interviewRepository.findById.mockResolvedValue({
        id: 'interview-1',
        participants: [{ userId: 'u1' }],
      } as never);
      evaluationRepository.listByInterview.mockResolvedValue([]);

      const summary = await service.summarize('org-1', 'interview-1');
      expect(summary.averageScore).toBeNull();
      expect(summary.evaluationsCompleted).toBe(0);
    });

    it('404s for a nonexistent/cross-tenant interview', async () => {
      const { service, interviewRepository } = makeService();
      interviewRepository.findById.mockResolvedValue(null);

      await expect(service.summarize('org-1', 'interview-x')).rejects.toThrow(NotFoundException);
    });
  });

  describe('decide — HR is the explicit authority', () => {
    it('rejects when the interview has already been decided (concurrency guard)', async () => {
      const { service, interviewRepository, decisionRepository } = makeService();
      interviewRepository.findById.mockResolvedValue({
        id: 'interview-1',
        interviewStageId: 'stage-1',
      } as never);
      decisionRepository.record.mockResolvedValue(null);

      await expect(
        service.decide('org-1', 'interview-1', 'ADVANCE', 'hr-1', undefined, 'app-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('REJECT always rejects the application', async () => {
      const { service, interviewRepository, decisionRepository, applicationRepository } =
        makeService();
      interviewRepository.findById.mockResolvedValue({
        id: 'interview-1',
        interviewStageId: 'stage-1',
      } as never);
      decisionRepository.record.mockResolvedValue({
        id: 'decision-1',
        decision: 'REJECT',
      } as never);

      await service.decide('org-1', 'interview-1', 'REJECT', 'hr-1', 'Not a fit', 'app-1');

      expect(applicationRepository.reject).toHaveBeenCalledWith('org-1', 'app-1', 'hr-1');
    });

    it('ADVANCE on a non-final stage leaves the application status untouched (HR must schedule the next stage explicitly)', async () => {
      const {
        service,
        interviewRepository,
        decisionRepository,
        interviewStageRepository,
        applicationRepository,
      } = makeService();
      interviewRepository.findById.mockResolvedValue({
        id: 'interview-1',
        interviewStageId: 'stage-1',
      } as never);
      decisionRepository.record.mockResolvedValue({
        id: 'decision-1',
        decision: 'ADVANCE',
      } as never);
      interviewStageRepository.findById.mockResolvedValue({
        id: 'stage-1',
        sequence: 1,
        vacancyId: 'v-1',
      } as never);
      interviewStageRepository.maxSequence.mockResolvedValue(2);

      await service.decide('org-1', 'interview-1', 'ADVANCE', 'hr-1', undefined, 'app-1');

      expect(applicationRepository.setStatus).not.toHaveBeenCalled();
    });

    it("ADVANCE on the LAST stage marks the application SELECTED (ready for HR's offer decision)", async () => {
      const {
        service,
        interviewRepository,
        decisionRepository,
        interviewStageRepository,
        applicationRepository,
      } = makeService();
      interviewRepository.findById.mockResolvedValue({
        id: 'interview-1',
        interviewStageId: 'stage-2',
      } as never);
      decisionRepository.record.mockResolvedValue({
        id: 'decision-1',
        decision: 'ADVANCE',
      } as never);
      interviewStageRepository.findById.mockResolvedValue({
        id: 'stage-2',
        sequence: 2,
        vacancyId: 'v-1',
      } as never);
      interviewStageRepository.maxSequence.mockResolvedValue(2);

      await service.decide('org-1', 'interview-1', 'ADVANCE', 'hr-1', undefined, 'app-1');

      expect(applicationRepository.setStatus).toHaveBeenCalledWith('org-1', 'app-1', 'SELECTED');
    });

    it('HOLD never changes the application status', async () => {
      const { service, interviewRepository, decisionRepository, applicationRepository } =
        makeService();
      interviewRepository.findById.mockResolvedValue({
        id: 'interview-1',
        interviewStageId: 'stage-1',
      } as never);
      decisionRepository.record.mockResolvedValue({ id: 'decision-1', decision: 'HOLD' } as never);

      await service.decide('org-1', 'interview-1', 'HOLD', 'hr-1', 'Need a second look', 'app-1');

      expect(applicationRepository.setStatus).not.toHaveBeenCalled();
      expect(applicationRepository.reject).not.toHaveBeenCalled();
    });
  });
});
