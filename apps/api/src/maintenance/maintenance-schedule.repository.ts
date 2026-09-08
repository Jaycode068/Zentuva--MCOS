import { Injectable } from '@nestjs/common';
import {
  AssetMeterType,
  MaintenanceFrequencyUnit,
  MaintenancePlanTask,
  MaintenanceSchedule,
  MaintenanceScheduleStatus,
  MaintenanceScheduleType,
  Prisma,
  WorkOrder,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { generateWorkOrderCode } from './work-order-code';

export interface ListMaintenanceSchedulesParams {
  status?: MaintenanceScheduleStatus;
  assetId?: string;
  maintenancePlanId?: string;
}

export interface CreateMaintenanceScheduleData {
  organisationId: string;
  maintenancePlanId: string;
  assetId: string;
  scheduleType: MaintenanceScheduleType;
  frequencyValue?: number;
  frequencyUnit?: MaintenanceFrequencyUnit;
  nextDueDate?: Date;
  meterType?: AssetMeterType;
  meterInterval?: number;
  nextDueMeterReading?: number;
  idempotencyKey?: string;
  createdById: string;
}

export interface CreateMaintenanceScheduleResult {
  maintenanceSchedule: MaintenanceSchedule;
  wasCreated: boolean;
}

export interface GenerateScheduleResult {
  generated: boolean;
  reason?: 'inactive' | 'not_due' | 'no_meter';
  workOrder?: WorkOrder;
  maintenanceSchedule: MaintenanceSchedule;
}

/** `nextDueDate` is never before `now` — the "step forward from a base
 *  date by N units" helper `MaintenanceScheduleRepository.generate()`
 *  uses to advance a date-based schedule's due marker after generating. */
export function addFrequency(base: Date, value: number, unit: MaintenanceFrequencyUnit): Date {
  const result = new Date(base);
  switch (unit) {
    case 'DAYS':
      result.setDate(result.getDate() + value);
      break;
    case 'WEEKS':
      result.setDate(result.getDate() + value * 7);
      break;
    case 'MONTHS':
      result.setMonth(result.getMonth() + value);
      break;
    case 'YEARS':
      result.setFullYear(result.getFullYear() + value);
      break;
  }
  return result;
}

/**
 * Thin Prisma access for `MaintenanceSchedule` (Sprint 21, docs/domains/
 * maintenance.md "Preventive Scheduling Idempotency"). `generate()` is the
 * central preventive-maintenance engine: when due, it creates exactly one
 * `WorkOrder` (with tasks copied from the plan's own template) and
 * immediately advances the due marker to the *next* occurrence, all
 * inside one transaction — so an immediate repeat call finds nothing due.
 * No separate duplicate-check bookkeeping needed; idempotency is a
 * structural consequence of always moving the due marker forward before
 * the transaction commits.
 */
@Injectable()
export class MaintenanceScheduleRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(organisationId: string, id: string): Promise<MaintenanceSchedule | null> {
    return this.prisma.maintenanceSchedule.findFirst({ where: { id, organisationId } });
  }

  findManyByOrganisation(
    organisationId: string,
    params: ListMaintenanceSchedulesParams = {},
  ): Promise<MaintenanceSchedule[]> {
    return this.prisma.maintenanceSchedule.findMany({
      where: {
        organisationId,
        ...(params.status ? { status: params.status } : {}),
        ...(params.assetId ? { assetId: params.assetId } : {}),
        ...(params.maintenancePlanId ? { maintenancePlanId: params.maintenancePlanId } : {}),
      },
      orderBy: { nextDueDate: 'asc' },
    });
  }

  async create(data: CreateMaintenanceScheduleData): Promise<CreateMaintenanceScheduleResult> {
    return this.prisma.$transaction(async (tx) => {
      if (data.idempotencyKey) {
        const existing = await tx.maintenanceSchedule.findUnique({
          where: {
            organisationId_idempotencyKey: {
              organisationId: data.organisationId,
              idempotencyKey: data.idempotencyKey,
            },
          },
        });
        if (existing) {
          return { maintenanceSchedule: existing, wasCreated: false };
        }
      }

      const maintenanceSchedule = await tx.maintenanceSchedule.create({
        data: {
          organisationId: data.organisationId,
          maintenancePlanId: data.maintenancePlanId,
          assetId: data.assetId,
          scheduleType: data.scheduleType,
          frequencyValue: data.frequencyValue,
          frequencyUnit: data.frequencyUnit,
          nextDueDate: data.nextDueDate,
          meterType: data.meterType,
          meterInterval: data.meterInterval,
          nextDueMeterReading: data.nextDueMeterReading,
          idempotencyKey: data.idempotencyKey,
          createdById: data.createdById,
        },
      });

      return { maintenanceSchedule, wasCreated: true };
    });
  }

  update(
    organisationId: string,
    id: string,
    data: Prisma.MaintenanceScheduleUncheckedUpdateInput,
  ): Promise<MaintenanceSchedule | null> {
    return this.updateMatching(organisationId, id, data);
  }

  deactivate(organisationId: string, id: string): Promise<MaintenanceSchedule | null> {
    return this.updateMatching(organisationId, id, {
      status: MaintenanceScheduleStatus.INACTIVE,
    });
  }

  activate(organisationId: string, id: string): Promise<MaintenanceSchedule | null> {
    return this.updateMatching(organisationId, id, { status: MaintenanceScheduleStatus.ACTIVE });
  }

  /**
   * Atomic: checks due, creates one `WorkOrder` + its tasks (copied from
   * the plan's template) + advances the due marker — all inside one
   * transaction, or does nothing at all. `idempotencyKey` guards the rare
   * double-click/network-retry case; the due-marker advancement itself is
   * what guards against re-running generation for the same due
   * occurrence.
   */
  async generate(
    organisationId: string,
    scheduleId: string,
    createdById: string,
    idempotencyKey?: string,
  ): Promise<GenerateScheduleResult> {
    return this.prisma.$transaction(async (tx) => {
      const schedule = await tx.maintenanceSchedule.findFirstOrThrow({
        where: { id: scheduleId, organisationId },
      });

      if (idempotencyKey) {
        const existingWorkOrder = await tx.workOrder.findFirst({
          where: {
            organisationId,
            maintenancePlanId: schedule.maintenancePlanId,
            idempotencyKey,
          },
        });
        if (existingWorkOrder) {
          return { generated: true, workOrder: existingWorkOrder, maintenanceSchedule: schedule };
        }
      }

      if (schedule.status !== 'ACTIVE') {
        return { generated: false, reason: 'inactive' as const, maintenanceSchedule: schedule };
      }

      const now = new Date();
      let isDue = false;
      let currentMeterReading: number | undefined;

      if (schedule.scheduleType === 'DATE_BASED') {
        isDue = !!schedule.nextDueDate && schedule.nextDueDate <= now;
      } else {
        const meter = await tx.assetMeter.findFirst({
          where: { organisationId, assetId: schedule.assetId, meterType: schedule.meterType! },
        });
        if (!meter) {
          return { generated: false, reason: 'no_meter' as const, maintenanceSchedule: schedule };
        }
        currentMeterReading = meter.currentReading;
        isDue =
          schedule.nextDueMeterReading !== null &&
          meter.currentReading >= schedule.nextDueMeterReading;
      }

      if (!isDue) {
        return { generated: false, reason: 'not_due' as const, maintenanceSchedule: schedule };
      }

      const plan = await tx.maintenancePlan.findUniqueOrThrow({
        where: { id: schedule.maintenancePlanId },
        include: { tasks: { orderBy: { sequence: 'asc' } } },
      });
      const asset = await tx.asset.findUniqueOrThrow({ where: { id: schedule.assetId } });

      const workOrderCode = await generateWorkOrderCode(tx, organisationId);

      const workOrder = await tx.workOrder.create({
        data: {
          organisationId,
          workOrderCode,
          assetId: schedule.assetId,
          maintenanceTypeId: plan.maintenanceTypeId,
          maintenancePlanId: plan.id,
          title: `${plan.name} — ${asset.name}`,
          description: plan.description,
          priority: plan.priority,
          status: 'OPEN',
          plannedStartAt: schedule.scheduleType === 'DATE_BASED' ? schedule.nextDueDate : null,
          idempotencyKey,
          createdById,
          tasks: {
            create: plan.tasks.map((task: MaintenancePlanTask) => ({
              sequence: task.sequence,
              title: task.title,
              description: task.description,
              mandatory: task.mandatory,
              estimatedDurationMinutes: task.estimatedDurationMinutes,
            })),
          },
        },
      });

      const advancedFields: Prisma.MaintenanceScheduleUncheckedUpdateInput = {
        lastGeneratedAt: now,
        lastGeneratedWorkOrderId: workOrder.id,
      };
      if (schedule.scheduleType === 'DATE_BASED') {
        advancedFields.nextDueDate = addFrequency(
          schedule.nextDueDate ?? now,
          schedule.frequencyValue!,
          schedule.frequencyUnit!,
        );
      } else {
        advancedFields.nextDueMeterReading =
          (currentMeterReading ?? schedule.nextDueMeterReading ?? 0) + schedule.meterInterval!;
      }

      const updatedSchedule = await tx.maintenanceSchedule.update({
        where: { id: schedule.id },
        data: advancedFields,
      });

      return { generated: true, workOrder, maintenanceSchedule: updatedSchedule };
    });
  }

  private async updateMatching(
    organisationId: string,
    id: string,
    data: Prisma.MaintenanceScheduleUncheckedUpdateInput,
  ): Promise<MaintenanceSchedule | null> {
    const result = await this.prisma.maintenanceSchedule.updateMany({
      where: { id, organisationId },
      data,
    });
    if (result.count === 0) {
      return null;
    }
    return this.prisma.maintenanceSchedule.findUniqueOrThrow({ where: { id } });
  }
}
