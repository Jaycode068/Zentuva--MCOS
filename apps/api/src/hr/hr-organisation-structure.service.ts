import { Injectable } from '@nestjs/common';

import { DepartmentRepository } from './department.repository';
import { EmployeeRepository } from './employee.repository';
import { PositionRepository } from './position.repository';

/** Read-only composition for a future organisation chart — departments
 *  with parent relationships, positions, employees with managers. A
 *  structured list/tree view, deliberately not a graph engine. */
@Injectable()
export class HrOrganisationStructureService {
  constructor(
    private readonly departmentRepository: DepartmentRepository,
    private readonly positionRepository: PositionRepository,
    private readonly employeeRepository: EmployeeRepository,
  ) {}

  async getStructure(organisationId: string) {
    const [departments, positions, employees] = await Promise.all([
      this.departmentRepository.findManyByOrganisation(organisationId),
      this.positionRepository.findManyByOrganisation(organisationId),
      this.employeeRepository.findManyLite(organisationId),
    ]);

    return { departments, positions, employees };
  }
}
