import { Injectable } from '@nestjs/common';
import { Offer, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

export interface CreateOfferData {
  organisationId: string;
  applicationId: string;
  proposedSalary?: number;
  employmentType: Prisma.OfferCreateInput['employmentType'];
  proposedStartDate?: Date;
  expiryDate?: Date;
  notes?: string;
  issuedByUserId: string;
}

/**
 * Sprint 30 — Recruitment & Candidate Interview Management Foundation
 * (recruitment.md §"Offer"). A migration-level partial unique index
 * (`hr_recruitment_offers_one_active_per_application`, `WHERE status IN
 * ('DRAFT','ISSUED')`) enforces "at most one non-terminal offer per
 * application at a time" — `create()` returns `null` on that P2002 conflict,
 * the duplicate-offer-creation guard (brief §43).
 */
@Injectable()
export class OfferRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(organisationId: string, id: string): Promise<Offer | null> {
    return this.prisma.offer.findFirst({ where: { id, organisationId } });
  }

  listByApplication(organisationId: string, applicationId: string): Promise<Offer[]> {
    return this.prisma.offer.findMany({
      where: { organisationId, applicationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  list(organisationId: string, status?: Offer['status']) {
    return this.prisma.offer.findMany({
      where: { organisationId, ...(status ? { status } : {}) },
      include: {
        application: { include: { candidate: true, vacancy: { select: { title: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(data: CreateOfferData): Promise<Offer | null> {
    try {
      return await this.prisma.offer.create({ data: { ...data, status: 'DRAFT' } });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_CONSTRAINT_VIOLATION
      ) {
        return null;
      }
      throw error;
    }
  }

  async issue(organisationId: string, id: string): Promise<Offer | null> {
    const result = await this.prisma.offer.updateMany({
      where: { id, organisationId, status: 'DRAFT' },
      data: { status: 'ISSUED' },
    });
    if (result.count === 0) {
      return null;
    }
    return this.findById(organisationId, id);
  }

  async decline(organisationId: string, id: string, notes?: string): Promise<Offer | null> {
    const result = await this.prisma.offer.updateMany({
      where: { id, organisationId, status: 'ISSUED' },
      data: { status: 'DECLINED', respondedAt: new Date(), ...(notes ? { notes } : {}) },
    });
    if (result.count === 0) {
      return null;
    }
    return this.findById(organisationId, id);
  }

  async withdraw(organisationId: string, id: string): Promise<Offer | null> {
    const result = await this.prisma.offer.updateMany({
      where: { id, organisationId, status: { in: ['DRAFT', 'ISSUED'] } },
      data: { status: 'WITHDRAWN' },
    });
    if (result.count === 0) {
      return null;
    }
    return this.findById(organisationId, id);
  }

  async expire(organisationId: string, id: string): Promise<Offer | null> {
    const result = await this.prisma.offer.updateMany({
      where: { id, organisationId, status: 'ISSUED' },
      data: { status: 'EXPIRED' },
    });
    if (result.count === 0) {
      return null;
    }
    return this.findById(organisationId, id);
  }

  /** The concurrency guard against a double-accept creating two `Employee`
   *  rows (brief §43/§50) — split into two steps so the `Employee` is only
   *  ever created by whichever concurrent request actually WINS this
   *  conditional `ISSUED → ACCEPTED` claim (a losing request's `updateMany`
   *  affects 0 rows and returns `null` BEFORE any `Employee` is created —
   *  see `OfferService.accept()`, which calls this first, then creates the
   *  `Employee`, then calls `confirmConversion` below). `convertedEmployeeId`
   *  stays `null` until the winner has actually created the employee. */
  async claimAcceptance(organisationId: string, id: string): Promise<Offer | null> {
    const result = await this.prisma.offer.updateMany({
      where: { id, organisationId, status: 'ISSUED' },
      data: { status: 'ACCEPTED', respondedAt: new Date() },
    });
    if (result.count === 0) {
      return null;
    }
    return this.findById(organisationId, id);
  }

  /** Called ONLY by the request that won `claimAcceptance` above, after it
   *  has created the `Employee` — `convertedEmployeeId: null` in the WHERE
   *  clause is a defensive idempotency guard (this method is never called
   *  twice for the same offer in practice, since only one request ever wins
   *  the claim), never a real second race window. */
  async confirmConversion(
    organisationId: string,
    id: string,
    employeeId: string,
  ): Promise<Offer | null> {
    const result = await this.prisma.offer.updateMany({
      where: { id, organisationId, convertedEmployeeId: null },
      data: { convertedEmployeeId: employeeId },
    });
    if (result.count === 0) {
      return null;
    }
    return this.findById(organisationId, id);
  }
}
