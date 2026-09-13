import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { TrainingCourse, TrainingCourseStatus } from '@prisma/client';
import { CreateTrainingCourseInput, UpdateTrainingCourseInput } from '@zentuva/validation';

import { CreateTrainingCourseResult, TrainingCourseRepository } from './training-course.repository';

@Injectable()
export class TrainingCourseService {
  constructor(private readonly trainingCourseRepository: TrainingCourseRepository) {}

  getById(organisationId: string, id: string): Promise<TrainingCourse> {
    return this.getByIdOrThrow(organisationId, id);
  }

  list(
    organisationId: string,
    params?: { status?: TrainingCourseStatus },
  ): Promise<TrainingCourse[]> {
    return this.trainingCourseRepository.findManyByOrganisation(organisationId, params);
  }

  create(
    organisationId: string,
    input: CreateTrainingCourseInput,
  ): Promise<CreateTrainingCourseResult> {
    return this.trainingCourseRepository.create({ organisationId, ...input });
  }

  async update(
    organisationId: string,
    id: string,
    input: UpdateTrainingCourseInput,
  ): Promise<TrainingCourse> {
    await this.getByIdOrThrow(organisationId, id);
    const updated = await this.trainingCourseRepository.update(organisationId, id, input);
    if (!updated) {
      throw new NotFoundException('Training course not found');
    }
    return updated;
  }

  async activate(organisationId: string, id: string): Promise<TrainingCourse> {
    const course = await this.getByIdOrThrow(organisationId, id);
    if (course.status === 'ACTIVE') {
      return course;
    }
    const updated = await this.trainingCourseRepository.setStatus(organisationId, id, 'ACTIVE');
    if (!updated) {
      throw new NotFoundException('Training course not found');
    }
    return updated;
  }

  async archive(organisationId: string, id: string): Promise<TrainingCourse> {
    const course = await this.getByIdOrThrow(organisationId, id);
    if (course.status === 'ARCHIVED') {
      return course;
    }
    const updated = await this.trainingCourseRepository.setStatus(organisationId, id, 'ARCHIVED');
    if (!updated) {
      throw new NotFoundException('Training course not found');
    }
    return updated;
  }

  async assertActiveForAssignment(organisationId: string, id: string): Promise<TrainingCourse> {
    const course = await this.getByIdOrThrow(organisationId, id);
    if (course.status !== 'ACTIVE') {
      throw new BadRequestException('Only an active training course can be assigned');
    }
    return course;
  }

  private async getByIdOrThrow(organisationId: string, id: string): Promise<TrainingCourse> {
    const course = await this.trainingCourseRepository.findById(organisationId, id);
    if (!course) {
      throw new NotFoundException('Training course not found');
    }
    return course;
  }
}
