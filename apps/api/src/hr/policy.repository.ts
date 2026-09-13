import { Injectable } from '@nestjs/common';
import { Policy, PolicyStatus, PolicyVersion, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { generateNextVersionNumber } from './policy-version-number';

export interface CreatePolicyData {
  organisationId: string;
  code: string;
  title: string;
  description?: string;
  scopeType?: 'ORGANISATION' | 'DEPARTMENT';
  departmentId?: string;
  ownerDepartmentId?: string;
}

export interface CreatePolicyResult {
  policy: Policy;
  wasCreated: boolean;
}

export interface CreatePolicyVersionData {
  organisationId: string;
  policyId: string;
  content: string;
  effectiveDate: Date;
  requiresAcknowledgement?: boolean;
}

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

@Injectable()
export class PolicyRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(organisationId: string, id: string): Promise<Policy | null> {
    return this.prisma.policy.findFirst({ where: { id, organisationId } });
  }

  findManyByOrganisation(
    organisationId: string,
    params: { status?: PolicyStatus } = {},
  ): Promise<Policy[]> {
    return this.prisma.policy.findMany({
      where: { organisationId, ...(params.status ? { status: params.status } : {}) },
      orderBy: { code: 'asc' },
    });
  }

  async create(data: CreatePolicyData): Promise<CreatePolicyResult> {
    try {
      const policy = await this.prisma.policy.create({
        data: {
          organisationId: data.organisationId,
          code: data.code,
          title: data.title,
          description: data.description,
          scopeType: data.scopeType,
          departmentId: data.departmentId,
          ownerDepartmentId: data.ownerDepartmentId,
        },
      });
      return { policy, wasCreated: true };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_CONSTRAINT_VIOLATION
      ) {
        const existing = await this.prisma.policy.findFirst({
          where: { organisationId: data.organisationId, code: data.code },
        });
        if (existing) {
          return { policy: existing, wasCreated: false };
        }
      }
      throw error;
    }
  }

  update(
    organisationId: string,
    id: string,
    data: Prisma.PolicyUncheckedUpdateInput,
  ): Promise<Policy | null> {
    return this.updateMatching(organisationId, id, data);
  }

  archive(organisationId: string, id: string): Promise<Policy | null> {
    return this.updateMatching(organisationId, id, { status: 'ARCHIVED' });
  }

  private async updateMatching(
    organisationId: string,
    id: string,
    data: Prisma.PolicyUncheckedUpdateInput,
  ): Promise<Policy | null> {
    const result = await this.prisma.policy.updateMany({ where: { id, organisationId }, data });
    if (result.count === 0) {
      return null;
    }
    return this.prisma.policy.findUniqueOrThrow({ where: { id } });
  }

  // --- Versions ---------------------------------------------------------

  findVersionById(organisationId: string, id: string): Promise<PolicyVersion | null> {
    return this.prisma.policyVersion.findFirst({ where: { id, organisationId } });
  }

  findVersionsByPolicy(organisationId: string, policyId: string): Promise<PolicyVersion[]> {
    return this.prisma.policyVersion.findMany({
      where: { organisationId, policyId },
      orderBy: { versionNumber: 'desc' },
    });
  }

  findPublishedVersion(organisationId: string, policyId: string): Promise<PolicyVersion | null> {
    return this.prisma.policyVersion.findFirst({
      where: { organisationId, policyId, status: 'PUBLISHED' },
    });
  }

  async createVersion(data: CreatePolicyVersionData): Promise<PolicyVersion> {
    return this.prisma.$transaction(async (tx) => {
      const versionNumber = await generateNextVersionNumber(tx, data.policyId);
      return tx.policyVersion.create({
        data: {
          organisationId: data.organisationId,
          policyId: data.policyId,
          versionNumber,
          content: data.content,
          effectiveDate: data.effectiveDate,
          requiresAcknowledgement: data.requiresAcknowledgement ?? false,
        },
      });
    });
  }

  /** Publishing a version auto-archives whichever version was previously
   *  PUBLISHED for the same policy — only one current version at a time —
   *  all inside one transaction. */
  async publishVersion(
    organisationId: string,
    id: string,
    policyId: string,
    publishedByUserId: string,
  ): Promise<PolicyVersion | null> {
    return this.prisma.$transaction(async (tx) => {
      await tx.policyVersion.updateMany({
        where: { organisationId, policyId, status: 'PUBLISHED' },
        data: { status: 'ARCHIVED' },
      });
      const result = await tx.policyVersion.updateMany({
        where: { id, organisationId, status: 'DRAFT' },
        data: { status: 'PUBLISHED', publishedAt: new Date(), publishedByUserId },
      });
      if (result.count === 0) {
        return null;
      }
      return tx.policyVersion.findUniqueOrThrow({ where: { id } });
    });
  }
}
