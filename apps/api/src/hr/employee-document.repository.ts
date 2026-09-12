import { Injectable } from '@nestjs/common';
import { EmployeeDocument, EmployeeDocumentType, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

export interface CreateEmployeeDocumentData {
  organisationId: string;
  employeeId: string;
  documentType: EmployeeDocumentType;
  name: string;
  description?: string;
  url: string;
  key: string;
  issuedDate?: Date;
  expiryDate?: Date;
  uploadedByUserId?: string;
}

@Injectable()
export class EmployeeDocumentRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(organisationId: string, id: string): Promise<EmployeeDocument | null> {
    return this.prisma.employeeDocument.findFirst({ where: { id, organisationId } });
  }

  findManyByEmployee(organisationId: string, employeeId: string): Promise<EmployeeDocument[]> {
    return this.prisma.employeeDocument.findMany({
      where: { organisationId, employeeId },
      orderBy: { createdAt: 'desc' },
    });
  }

  create(data: CreateEmployeeDocumentData): Promise<EmployeeDocument> {
    return this.prisma.employeeDocument.create({ data });
  }

  async update(
    organisationId: string,
    id: string,
    data: Prisma.EmployeeDocumentUncheckedUpdateInput,
  ): Promise<EmployeeDocument | null> {
    const result = await this.prisma.employeeDocument.updateMany({
      where: { id, organisationId },
      data,
    });
    if (result.count === 0) {
      return null;
    }
    return this.prisma.employeeDocument.findUniqueOrThrow({ where: { id } });
  }
}
