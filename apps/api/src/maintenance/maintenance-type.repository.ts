import { Injectable } from '@nestjs/common';
import { MaintenanceType, MaintenanceTypeStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

export interface ListMaintenanceTypesParams {
  status?: MaintenanceTypeStatus;
}

export interface CreateMaintenanceTypeData {
  organisationId: string;
  code: string;
  name: string;
  description?: string;
  createdById: string;
}

export interface CreateMaintenanceTypeResult {
  maintenanceType: MaintenanceType;
  wasCreated: boolean;
}

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

/**
 * Thin Prisma access for `MaintenanceType` (Sprint 21, docs/domains/
 * maintenance.md) — tenant-defined maintenance classification, never a
 * hard-coded enum. No `idempotencyKey` column — `create()` instead catches
 * the `@@unique([organisationId, code])` violation and returns the
 * existing row, the exact `AssetCategoryRepository.create()` pattern
 * (Sprint 20).
 */
@Injectable()
export class MaintenanceTypeRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(organisationId: string, id: string): Promise<MaintenanceType | null> {
    return this.prisma.maintenanceType.findFirst({ where: { id, organisationId } });
  }

  findManyByOrganisation(
    organisationId: string,
    params: ListMaintenanceTypesParams = {},
  ): Promise<MaintenanceType[]> {
    return this.prisma.maintenanceType.findMany({
      where: { organisationId, ...(params.status ? { status: params.status } : {}) },
      orderBy: { code: 'asc' },
    });
  }

  async create(data: CreateMaintenanceTypeData): Promise<CreateMaintenanceTypeResult> {
    try {
      const maintenanceType = await this.prisma.maintenanceType.create({
        data: {
          organisationId: data.organisationId,
          code: data.code,
          name: data.name,
          description: data.description,
          createdById: data.createdById,
        },
      });
      return { maintenanceType, wasCreated: true };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_CONSTRAINT_VIOLATION
      ) {
        const existing = await this.prisma.maintenanceType.findFirst({
          where: { organisationId: data.organisationId, code: data.code },
        });
        if (existing) {
          return { maintenanceType: existing, wasCreated: false };
        }
      }
      throw error;
    }
  }

  update(
    organisationId: string,
    id: string,
    data: Prisma.MaintenanceTypeUncheckedUpdateInput,
  ): Promise<MaintenanceType | null> {
    return this.updateMatching(organisationId, id, data);
  }

  deactivate(organisationId: string, id: string): Promise<MaintenanceType | null> {
    return this.updateMatching(organisationId, id, { status: MaintenanceTypeStatus.INACTIVE });
  }

  activate(organisationId: string, id: string): Promise<MaintenanceType | null> {
    return this.updateMatching(organisationId, id, { status: MaintenanceTypeStatus.ACTIVE });
  }

  private async updateMatching(
    organisationId: string,
    id: string,
    data: Prisma.MaintenanceTypeUncheckedUpdateInput,
  ): Promise<MaintenanceType | null> {
    const result = await this.prisma.maintenanceType.updateMany({
      where: { id, organisationId },
      data,
    });
    if (result.count === 0) {
      return null;
    }
    return this.prisma.maintenanceType.findUniqueOrThrow({ where: { id } });
  }
}
