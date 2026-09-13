import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Policy, PolicyStatus, PolicyVersion } from '@prisma/client';
import {
  AcknowledgePolicyInput,
  CreatePolicyInput,
  CreatePolicyVersionInput,
  UpdatePolicyInput,
} from '@zentuva/validation';

import { DepartmentRepository } from './department.repository';
import { EmployeeRepository } from './employee.repository';
import { PolicyAcknowledgementRepository } from './policy-acknowledgement.repository';
import { CreatePolicyResult, PolicyRepository } from './policy.repository';

@Injectable()
export class PolicyService {
  constructor(
    private readonly policyRepository: PolicyRepository,
    private readonly departmentRepository: DepartmentRepository,
    private readonly employeeRepository: EmployeeRepository,
    private readonly acknowledgementRepository: PolicyAcknowledgementRepository,
  ) {}

  getById(organisationId: string, id: string): Promise<Policy> {
    return this.getByIdOrThrow(organisationId, id);
  }

  list(organisationId: string, params?: { status?: PolicyStatus }): Promise<Policy[]> {
    return this.policyRepository.findManyByOrganisation(organisationId, params);
  }

  async create(organisationId: string, input: CreatePolicyInput): Promise<CreatePolicyResult> {
    if (input.departmentId) {
      await this.assertDepartmentExists(organisationId, input.departmentId);
    }
    if (input.ownerDepartmentId) {
      await this.assertDepartmentExists(organisationId, input.ownerDepartmentId);
    }
    if (input.scopeType === 'DEPARTMENT' && !input.departmentId) {
      throw new BadRequestException('A department-scoped policy requires a departmentId');
    }
    return this.policyRepository.create({
      organisationId,
      code: input.code,
      title: input.title,
      description: input.description,
      scopeType: input.scopeType,
      departmentId: input.departmentId,
      ownerDepartmentId: input.ownerDepartmentId,
    });
  }

  async update(organisationId: string, id: string, input: UpdatePolicyInput): Promise<Policy> {
    await this.getByIdOrThrow(organisationId, id);
    if (input.departmentId) {
      await this.assertDepartmentExists(organisationId, input.departmentId);
    }
    if (input.ownerDepartmentId) {
      await this.assertDepartmentExists(organisationId, input.ownerDepartmentId);
    }
    const updated = await this.policyRepository.update(organisationId, id, {
      title: input.title,
      description: input.description,
      scopeType: input.scopeType,
      departmentId: input.departmentId,
      ownerDepartmentId: input.ownerDepartmentId,
    });
    if (!updated) {
      throw new NotFoundException('Policy not found');
    }
    return updated;
  }

  async archive(organisationId: string, id: string): Promise<Policy> {
    await this.getByIdOrThrow(organisationId, id);
    const updated = await this.policyRepository.archive(organisationId, id);
    if (!updated) {
      throw new NotFoundException('Policy not found');
    }
    return updated;
  }

  listVersions(organisationId: string, policyId: string): Promise<PolicyVersion[]> {
    return this.policyRepository.findVersionsByPolicy(organisationId, policyId);
  }

  async createVersion(
    organisationId: string,
    policyId: string,
    input: CreatePolicyVersionInput,
  ): Promise<PolicyVersion> {
    const policy = await this.getByIdOrThrow(organisationId, policyId);
    if (policy.status === 'ARCHIVED') {
      throw new BadRequestException('Cannot add a version to an archived policy');
    }
    return this.policyRepository.createVersion({
      organisationId,
      policyId,
      content: input.content,
      effectiveDate: input.effectiveDate,
      requiresAcknowledgement: input.requiresAcknowledgement,
    });
  }

  /** Publishing auto-archives the previously-published version and, if the
   *  policy itself was still DRAFT, flips it to ACTIVE — a policy only
   *  becomes ACTIVE once it has a real published version. Published/
   *  archived versions are immutable: only a DRAFT version can be
   *  published (enforced at the repository's `updateMany` `where`). */
  async publishVersion(
    organisationId: string,
    policyId: string,
    versionId: string,
    publishedByUserId: string,
  ): Promise<PolicyVersion> {
    const policy = await this.getByIdOrThrow(organisationId, policyId);
    if (policy.status === 'ARCHIVED') {
      throw new BadRequestException('Cannot publish a version of an archived policy');
    }
    const version = await this.getVersionOrThrow(organisationId, versionId);
    if (version.policyId !== policyId) {
      throw new BadRequestException('Version does not belong to this policy');
    }
    if (version.status !== 'DRAFT') {
      throw new BadRequestException('Only a draft version can be published');
    }

    const published = await this.policyRepository.publishVersion(
      organisationId,
      versionId,
      policyId,
      publishedByUserId,
    );
    if (!published) {
      throw new BadRequestException('Only a draft version can be published');
    }
    if (policy.status === 'DRAFT') {
      await this.policyRepository.update(organisationId, policyId, { status: 'ACTIVE' });
    }
    return published;
  }

  /** For this sprint, acknowledgement may be recorded administratively on
   *  behalf of an employee (no employee self-service acknowledgement UI
   *  exists yet — a documented limitation, see docs/domains/hr.md). */
  async acknowledge(
    organisationId: string,
    versionId: string,
    input: AcknowledgePolicyInput,
    acknowledgedByUserId: string,
  ) {
    const version = await this.getVersionOrThrow(organisationId, versionId);
    if (version.status !== 'PUBLISHED') {
      throw new BadRequestException('Only a published policy version can be acknowledged');
    }

    let employeeId = input.employeeId;
    let source: 'SELF_SERVICE' | 'ADMINISTRATIVE' = 'ADMINISTRATIVE';
    if (!employeeId) {
      const selfEmployee = await this.employeeRepository.findByUserId(
        organisationId,
        acknowledgedByUserId,
      );
      if (!selfEmployee) {
        throw new BadRequestException('No employee record is linked to this user account');
      }
      employeeId = selfEmployee.id;
      source = 'SELF_SERVICE';
    } else {
      const employee = await this.employeeRepository.findById(organisationId, employeeId);
      if (!employee) {
        throw new BadRequestException('Employee not found in this organisation');
      }
    }

    return this.acknowledgementRepository.create({
      organisationId,
      employeeId,
      policyVersionId: versionId,
      acknowledgedByUserId,
      source,
      notes: input.notes,
    });
  }

  listAcknowledgementsForEmployee(organisationId: string, employeeId: string) {
    return this.acknowledgementRepository.findManyByEmployee(organisationId, employeeId);
  }

  private async assertDepartmentExists(organisationId: string, departmentId: string) {
    const department = await this.departmentRepository.findById(organisationId, departmentId);
    if (!department) {
      throw new BadRequestException('Department not found in this organisation');
    }
  }

  private async getByIdOrThrow(organisationId: string, id: string): Promise<Policy> {
    const policy = await this.policyRepository.findById(organisationId, id);
    if (!policy) {
      throw new NotFoundException('Policy not found');
    }
    return policy;
  }

  private async getVersionOrThrow(organisationId: string, id: string): Promise<PolicyVersion> {
    const version = await this.policyRepository.findVersionById(organisationId, id);
    if (!version) {
      throw new NotFoundException('Policy version not found');
    }
    return version;
  }
}
