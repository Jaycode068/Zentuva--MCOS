import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EmployeeTraining, EmployeeTrainingStatus } from '@prisma/client';
import {
  AssignTrainingInput,
  CompleteEmployeeTrainingInput,
  UpdateEmployeeTrainingInput,
} from '@zentuva/validation';

import { EmployeeDocumentRepository } from './employee-document.repository';
import { EmployeeRepository } from './employee.repository';
import {
  EmployeeTrainingRepository,
  ListEmployeeTrainingParams,
  ListEmployeeTrainingResult,
} from './employee-training.repository';
import { TrainingCourseService } from './training-course.service';

const TERMINAL_STATUSES: EmployeeTrainingStatus[] = ['COMPLETED', 'CANCELLED'];

@Injectable()
export class EmployeeTrainingService {
  constructor(
    private readonly employeeTrainingRepository: EmployeeTrainingRepository,
    private readonly employeeRepository: EmployeeRepository,
    private readonly trainingCourseService: TrainingCourseService,
    private readonly employeeDocumentRepository: EmployeeDocumentRepository,
  ) {}

  async getById(organisationId: string, id: string) {
    await this.employeeTrainingRepository.syncOverdue(organisationId);
    const record = await this.employeeTrainingRepository.findByIdWithRelations(organisationId, id);
    if (!record) {
      throw new NotFoundException('Training assignment not found');
    }
    return record;
  }

  async list(
    organisationId: string,
    params: ListEmployeeTrainingParams,
  ): Promise<ListEmployeeTrainingResult> {
    await this.employeeTrainingRepository.syncOverdue(organisationId);
    return this.employeeTrainingRepository.findManyPaginated(organisationId, params);
  }

  async listForEmployee(organisationId: string, employeeId: string): Promise<EmployeeTraining[]> {
    await this.employeeTrainingRepository.syncOverdue(organisationId);
    return this.employeeTrainingRepository.findManyByEmployee(organisationId, employeeId);
  }

  async assign(
    organisationId: string,
    trainingCourseId: string,
    input: AssignTrainingInput,
    assignedByUserId: string,
  ): Promise<EmployeeTraining> {
    const employee = await this.employeeRepository.findById(organisationId, input.employeeId);
    if (!employee) {
      throw new BadRequestException('Employee not found in this organisation');
    }
    await this.trainingCourseService.assertActiveForAssignment(organisationId, trainingCourseId);

    const existing = await this.employeeTrainingRepository.findActiveAssignment(
      organisationId,
      input.employeeId,
      trainingCourseId,
    );
    if (existing) {
      throw new BadRequestException(
        'This employee already has an active assignment for this course',
      );
    }

    return this.employeeTrainingRepository.create({
      organisationId,
      employeeId: input.employeeId,
      trainingCourseId,
      assignedByUserId,
      dueDate: input.dueDate,
    });
  }

  async update(
    organisationId: string,
    id: string,
    input: UpdateEmployeeTrainingInput,
  ): Promise<EmployeeTraining> {
    const assignment = await this.getByIdOrThrow(organisationId, id);
    if (TERMINAL_STATUSES.includes(assignment.status)) {
      throw new BadRequestException(
        `Cannot modify a ${assignment.status.toLowerCase()} training assignment`,
      );
    }
    if (input.status === 'IN_PROGRESS' && !assignment.startedAt) {
      const updated = await this.employeeTrainingRepository.update(organisationId, id, {
        status: input.status,
        startedAt: new Date(),
        dueDate: input.dueDate,
        completionNotes: input.completionNotes,
      });
      if (!updated) {
        throw new NotFoundException('Training assignment not found');
      }
      return updated;
    }
    const updated = await this.employeeTrainingRepository.update(organisationId, id, {
      status: input.status,
      dueDate: input.dueDate,
      completionNotes: input.completionNotes,
      certificateDocumentId: input.certificateDocumentId,
    });
    if (!updated) {
      throw new NotFoundException('Training assignment not found');
    }
    return updated;
  }

  async complete(
    organisationId: string,
    id: string,
    input: CompleteEmployeeTrainingInput,
  ): Promise<EmployeeTraining> {
    const assignment = await this.getByIdOrThrow(organisationId, id);
    if (TERMINAL_STATUSES.includes(assignment.status)) {
      throw new BadRequestException(
        `Cannot complete a ${assignment.status.toLowerCase()} training assignment`,
      );
    }
    if (input.certificateDocumentId) {
      const document = await this.employeeDocumentRepository.findById(
        organisationId,
        input.certificateDocumentId,
      );
      if (!document || document.employeeId !== assignment.employeeId) {
        throw new BadRequestException(
          'Certificate document not found for this employee in this organisation',
        );
      }
    }

    const updated = await this.employeeTrainingRepository.update(organisationId, id, {
      status: 'COMPLETED',
      completedAt: new Date(),
      completionNotes: input.completionNotes,
      certificateDocumentId: input.certificateDocumentId,
    });
    if (!updated) {
      throw new NotFoundException('Training assignment not found');
    }
    return updated;
  }

  async cancel(organisationId: string, id: string): Promise<EmployeeTraining> {
    const assignment = await this.getByIdOrThrow(organisationId, id);
    if (TERMINAL_STATUSES.includes(assignment.status)) {
      throw new BadRequestException(
        `Cannot cancel a ${assignment.status.toLowerCase()} training assignment`,
      );
    }
    const updated = await this.employeeTrainingRepository.update(organisationId, id, {
      status: 'CANCELLED',
    });
    if (!updated) {
      throw new NotFoundException('Training assignment not found');
    }
    return updated;
  }

  private async getByIdOrThrow(organisationId: string, id: string): Promise<EmployeeTraining> {
    const assignment = await this.employeeTrainingRepository.findById(organisationId, id);
    if (!assignment) {
      throw new NotFoundException('Training assignment not found');
    }
    return assignment;
  }
}
