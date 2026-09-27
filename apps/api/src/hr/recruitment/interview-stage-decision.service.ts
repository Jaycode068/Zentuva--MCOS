import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InterviewStageDecision } from '@prisma/client';

import { ApplicationRepository } from './application.repository';
import { InterviewEvaluationRepository } from './interview-evaluation.repository';
import { InterviewRepository } from './interview.repository';
import { InterviewStageDecisionRepository } from './interview-stage-decision.repository';
import { InterviewStageRepository } from './interview-stage.repository';

export interface StageSummary {
  evaluatorsAssigned: number;
  evaluationsCompleted: number;
  averageScore: number | null;
  recommendationCounts: Record<string, number>;
}

/**
 * Sprint 30 — Recruitment & Candidate Interview Management Foundation
 * (recruitment.md §"Stage Summary" / §"HR Stage Decision" / §"No Automatic
 * Hiring Decision" — a CRITICAL business rule). `summarize()` computes
 * evidence — average score, recommendation counts, completion — on every
 * read, NEVER persisted, NEVER used to auto-decide anything. `advance()`/
 * `hold()`/`reject()` are HR's own explicit, authoritative action; the
 * summary is presented alongside it, never substituted for it.
 */
@Injectable()
export class InterviewStageDecisionService {
  constructor(
    private readonly decisionRepository: InterviewStageDecisionRepository,
    private readonly interviewRepository: InterviewRepository,
    private readonly evaluationRepository: InterviewEvaluationRepository,
    private readonly interviewStageRepository: InterviewStageRepository,
    private readonly applicationRepository: ApplicationRepository,
  ) {}

  async summarize(organisationId: string, interviewId: string): Promise<StageSummary> {
    const interview = await this.interviewRepository.findById(organisationId, interviewId);
    if (!interview) {
      throw new NotFoundException('Interview not found');
    }
    const evaluations = await this.evaluationRepository.listByInterview(
      organisationId,
      interviewId,
    );
    const evaluatorsAssigned = interview.participants.length;
    const evaluationsCompleted = evaluations.length;
    const averageScore =
      evaluations.length > 0
        ? Math.round((evaluations.reduce((sum, e) => sum + e.score, 0) / evaluations.length) * 10) /
          10
        : null;
    const recommendationCounts: Record<string, number> = {};
    for (const evaluation of evaluations) {
      recommendationCounts[evaluation.recommendation] =
        (recommendationCounts[evaluation.recommendation] ?? 0) + 1;
    }
    return { evaluatorsAssigned, evaluationsCompleted, averageScore, recommendationCounts };
  }

  async listDecisions(
    organisationId: string,
    interviewId: string,
  ): Promise<InterviewStageDecision[]> {
    return this.decisionRepository.listByInterview(organisationId, interviewId);
  }

  private async isLastStage(organisationId: string, interviewStageId: string): Promise<boolean> {
    const stage = await this.interviewStageRepository.findById(organisationId, interviewStageId);
    if (!stage) {
      throw new NotFoundException('Interview stage not found');
    }
    const maxSequence = await this.interviewStageRepository.maxSequence(stage.vacancyId);
    return stage.sequence === maxSequence;
  }

  /** Records the decision and, ONLY as a bookkeeping consequence of an
   *  explicit HR action (never auto-derived from scores), updates the
   *  `Application`'s coarse status: `ADVANCE` on the vacancy's LAST stage
   *  means "all required stages passed" → `SELECTED` (ready for HR's Offer
   *  decision, recruitment.md §"Final Hiring Decision" — issuing/withholding
   *  an Offer IS that decision; no separate "final decision" model exists).
   *  `ADVANCE` on a non-last stage leaves `Application.status` at
   *  `INTERVIEWING` — HR must explicitly schedule the NEXT stage separately
   *  (brief §26 "do not automatically schedule the next stage"). `REJECT`
   *  always sets `REJECTED`. `HOLD` never changes `Application.status`. */
  async decide(
    organisationId: string,
    interviewId: string,
    decision: 'ADVANCE' | 'HOLD' | 'REJECT',
    decidedByUserId: string,
    comment: string | undefined,
    applicationId: string,
  ): Promise<InterviewStageDecision> {
    const interview = await this.interviewRepository.findById(organisationId, interviewId);
    if (!interview) {
      throw new NotFoundException('Interview not found');
    }

    const recorded = await this.decisionRepository.record(
      organisationId,
      interviewId,
      decision,
      decidedByUserId,
      comment,
    );
    if (!recorded) {
      throw new BadRequestException(
        'This interview has already been decided — a decision can only be recorded once per scheduled interview',
      );
    }

    if (decision === 'REJECT') {
      await this.applicationRepository.reject(organisationId, applicationId, decidedByUserId);
    } else if (decision === 'ADVANCE') {
      const lastStage = await this.isLastStage(organisationId, interview.interviewStageId);
      if (lastStage) {
        await this.applicationRepository.setStatus(organisationId, applicationId, 'SELECTED');
      }
    }

    return recorded;
  }
}
