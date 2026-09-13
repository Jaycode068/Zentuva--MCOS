import { Injectable } from '@nestjs/common';
import { PolicyAcknowledgement, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

export interface CreateAcknowledgementData {
  organisationId: string;
  employeeId: string;
  policyVersionId: string;
  acknowledgedByUserId?: string;
  source: 'SELF_SERVICE' | 'ADMINISTRATIVE';
  notes?: string;
}

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

@Injectable()
export class PolicyAcknowledgementRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByEmployeeAndVersion(
    organisationId: string,
    employeeId: string,
    policyVersionId: string,
  ): Promise<PolicyAcknowledgement | null> {
    return this.prisma.policyAcknowledgement.findFirst({
      where: { organisationId, employeeId, policyVersionId },
    });
  }

  findManyByEmployee(organisationId: string, employeeId: string): Promise<PolicyAcknowledgement[]> {
    return this.prisma.policyAcknowledgement.findMany({
      where: { organisationId, employeeId },
      orderBy: { acknowledgedAt: 'desc' },
    });
  }

  findManyByPolicyVersion(
    organisationId: string,
    policyVersionId: string,
  ): Promise<PolicyAcknowledgement[]> {
    return this.prisma.policyAcknowledgement.findMany({
      where: { organisationId, policyVersionId },
      orderBy: { acknowledgedAt: 'desc' },
    });
  }

  async create(
    data: CreateAcknowledgementData,
  ): Promise<{ acknowledgement: PolicyAcknowledgement; wasCreated: boolean }> {
    try {
      const acknowledgement = await this.prisma.policyAcknowledgement.create({
        data: {
          organisationId: data.organisationId,
          employeeId: data.employeeId,
          policyVersionId: data.policyVersionId,
          acknowledgedByUserId: data.acknowledgedByUserId,
          source: data.source,
          notes: data.notes,
        },
      });
      return { acknowledgement, wasCreated: true };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_CONSTRAINT_VIOLATION
      ) {
        const existing = await this.findByEmployeeAndVersion(
          data.organisationId,
          data.employeeId,
          data.policyVersionId,
        );
        if (existing) {
          return { acknowledgement: existing, wasCreated: false };
        }
      }
      throw error;
    }
  }
}
