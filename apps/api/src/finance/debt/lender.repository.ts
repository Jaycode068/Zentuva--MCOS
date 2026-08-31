import { Injectable } from '@nestjs/common';
import { Lender, LenderStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

export interface ListLendersParams {
  status?: LenderStatus;
}

export interface CreateLenderData {
  organisationId: string;
  name: string;
  type: Lender['type'];
  contactName?: string;
  email?: string;
  phone?: string;
  notes?: string;
  createdById: string;
}

export interface CreateLenderResult {
  lender: Lender;
  wasCreated: boolean;
}

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

/**
 * Thin Prisma access for the `Lender` aggregate (Sprint 17, docs/domains/
 * debt-management.md §7) — a lightweight external financing party, never a
 * full CRM. No `idempotencyKey` column — `create()` catches the
 * `@@unique([organisationId, name])` violation and returns the existing row,
 * the same non-financial idempotent-by-construction pattern
 * `CostCentreRepository` (Sprint 16) already established.
 */
@Injectable()
export class LenderRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(organisationId: string, id: string): Promise<Lender | null> {
    return this.prisma.lender.findFirst({ where: { id, organisationId } });
  }

  findManyByOrganisation(
    organisationId: string,
    params: ListLendersParams = {},
  ): Promise<Lender[]> {
    return this.prisma.lender.findMany({
      where: { organisationId, ...(params.status ? { status: params.status } : {}) },
      orderBy: { name: 'asc' },
    });
  }

  async create(data: CreateLenderData): Promise<CreateLenderResult> {
    try {
      const lender = await this.prisma.lender.create({
        data: {
          organisationId: data.organisationId,
          name: data.name,
          type: data.type,
          contactName: data.contactName,
          email: data.email,
          phone: data.phone,
          notes: data.notes,
          createdById: data.createdById,
        },
      });
      return { lender, wasCreated: true };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_CONSTRAINT_VIOLATION
      ) {
        const existing = await this.prisma.lender.findFirst({
          where: { organisationId: data.organisationId, name: data.name },
        });
        if (existing) {
          return { lender: existing, wasCreated: false };
        }
      }
      throw error;
    }
  }

  update(
    organisationId: string,
    id: string,
    data: Prisma.LenderUpdateInput,
  ): Promise<Lender | null> {
    return this.updateMatching(organisationId, id, data);
  }

  private async updateMatching(
    organisationId: string,
    id: string,
    data: Prisma.LenderUpdateInput,
  ): Promise<Lender | null> {
    const result = await this.prisma.lender.updateMany({ where: { id, organisationId }, data });
    if (result.count === 0) {
      return null;
    }
    return this.prisma.lender.findUniqueOrThrow({ where: { id } });
  }
}
