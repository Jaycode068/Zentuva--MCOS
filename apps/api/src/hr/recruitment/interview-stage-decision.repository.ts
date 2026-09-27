import { Injectable } from '@nestjs/common';
import { InterviewStageDecision, StageDecisionType } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

/**
 * Sprint 30 — Recruitment & Candidate Interview Management Foundation
 * (recruitment.md §"HR Stage Decision" / §"Concurrency"). Append-only log,
 * mirroring `WorkflowDecision`'s own immutable-log convention exactly — but
 * the CONCURRENCY guarantee ("two simultaneous stage decisions produce
 * exactly one valid transition," brief §43/§50) comes from a conditional
 * `Interview.status` transition (`SCHEDULED → COMPLETED`) performed in the
 * SAME transaction as the decision insert: only the request that wins the
 * conditional `updateMany` race gets to insert a decision row at all — the
 * losing concurrent request's `updateMany` affects 0 rows and the whole
 * transaction is aborted, returning `null`.
 */
@Injectable()
export class InterviewStageDecisionRepository {
  constructor(private readonly prisma: PrismaService) {}

  listByInterview(organisationId: string, interviewId: string): Promise<InterviewStageDecision[]> {
    return this.prisma.interviewStageDecision.findMany({
      where: { organisationId, interviewId },
      orderBy: { decidedAt: 'desc' },
    });
  }

  async record(
    organisationId: string,
    interviewId: string,
    decision: StageDecisionType,
    decidedByUserId: string,
    comment?: string,
  ): Promise<InterviewStageDecision | null> {
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.interview.updateMany({
        where: { id: interviewId, organisationId, status: 'SCHEDULED' },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
      if (claimed.count === 0) {
        return null;
      }
      return tx.interviewStageDecision.create({
        data: { organisationId, interviewId, decision, decidedByUserId, comment },
      });
    });
  }
}
