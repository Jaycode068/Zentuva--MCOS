import { Injectable } from '@nestjs/common';
import { Prisma, WorkflowDefinition, WorkflowDefinitionStatus, WorkflowStep } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

export type WorkflowDefinitionWithSteps = WorkflowDefinition & { steps: WorkflowStep[] };

export interface ListWorkflowDefinitionsParams {
  status?: WorkflowDefinitionStatus;
  subjectType?: string;
}

export interface CreateWorkflowStepInput {
  name: string;
  code: string;
  sequence: number;
  requiredPermission: string;
  requiredScope?: Prisma.WorkflowStepCreateInput['requiredScope'];
  assignedUserId?: string | null;
}

const STEPS_ORDER = { steps: { orderBy: { sequence: 'asc' as const } } };

/**
 * Thin Prisma access for `WorkflowDefinition` + its `WorkflowStep`s — no business logic,
 * see `WorkflowDefinitionService` and docs/domains/workflow.md.
 *
 * Tenant-safety convention (matches every other domain repository, identity.md §7):
 * every method that reads or writes a specific definition takes `organisationId` and
 * includes it in the query; `WorkflowStep` rows are scoped through their parent
 * `WorkflowDefinition`, never carrying their own `organisationId` column (same
 * convention as `PurchaseOrderItem`/`SalesOrderItem`).
 */
@Injectable()
export class WorkflowDefinitionRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(organisationId: string, id: string): Promise<WorkflowDefinitionWithSteps | null> {
    return this.prisma.workflowDefinition.findFirst({
      where: { id, organisationId },
      include: STEPS_ORDER,
    });
  }

  findByCode(organisationId: string, code: string): Promise<WorkflowDefinitionWithSteps | null> {
    return this.prisma.workflowDefinition.findFirst({
      where: { organisationId, code },
      include: STEPS_ORDER,
    });
  }

  findManyByOrganisation(
    organisationId: string,
    params: ListWorkflowDefinitionsParams = {},
  ): Promise<WorkflowDefinitionWithSteps[]> {
    return this.prisma.workflowDefinition.findMany({
      where: {
        organisationId,
        ...(params.status ? { status: params.status } : {}),
        ...(params.subjectType ? { subjectType: params.subjectType } : {}),
      },
      include: STEPS_ORDER,
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Creates the definition and its steps atomically — a definition is never
   *  meaningfully valid without at least one step, so there is no "create header, add
   *  steps later" intermediate state. */
  createWithSteps(
    data: Prisma.WorkflowDefinitionUncheckedCreateInput,
    steps: CreateWorkflowStepInput[],
  ): Promise<WorkflowDefinitionWithSteps> {
    return this.prisma.workflowDefinition.create({
      data: { ...data, steps: { create: steps } },
      include: STEPS_ORDER,
    });
  }

  /** Updates header fields and, when `steps` is provided, replaces the entire step list
   *  within the same transaction — same "delete-then-recreate, no partial line-level
   *  update" convention `PurchaseOrderRepository.update` established for order items.
   *  Returns `null` if no row matched `(id, organisationId)`. */
  async update(
    organisationId: string,
    id: string,
    headerData: Prisma.WorkflowDefinitionUncheckedUpdateManyInput,
    steps?: CreateWorkflowStepInput[],
  ): Promise<WorkflowDefinitionWithSteps | null> {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.workflowDefinition.updateMany({
        where: { id, organisationId },
        data: headerData,
      });
      if (result.count === 0) {
        return null;
      }

      if (steps) {
        await tx.workflowStep.deleteMany({ where: { workflowDefinitionId: id } });
        await tx.workflowStep.createMany({
          data: steps.map((step) => ({ ...step, workflowDefinitionId: id })),
        });
      }

      return tx.workflowDefinition.findUniqueOrThrow({ where: { id }, include: STEPS_ORDER });
    });
  }

  async countInstances(organisationId: string, workflowDefinitionId: string): Promise<number> {
    return this.prisma.workflowInstance.count({
      where: { organisationId, workflowDefinitionId },
    });
  }

  async countActiveInstances(
    organisationId: string,
    workflowDefinitionId: string,
  ): Promise<number> {
    return this.prisma.workflowInstance.count({
      where: {
        organisationId,
        workflowDefinitionId,
        status: { in: ['DRAFT', 'SUBMITTED', 'IN_PROGRESS'] },
      },
    });
  }
}
