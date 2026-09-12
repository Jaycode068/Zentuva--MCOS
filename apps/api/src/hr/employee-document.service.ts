import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { EmployeeDocument, EmployeeDocumentType } from '@prisma/client';
import { UpdateEmployeeDocumentInput } from '@zentuva/validation';

import { FILE_STORAGE, FileStorage } from '../identity/organisation/ports/file-storage.port';
import { EmployeeRepository } from './employee.repository';
import { EmployeeDocumentRepository } from './employee-document.repository';

/** Document metadata only — reuses the shared `FileStorage` port exactly
 *  like `AssetDocumentService`/`MaintenanceDocumentService`. No binary
 *  content is ever stored in Postgres. */
@Injectable()
export class EmployeeDocumentService {
  constructor(
    private readonly employeeDocumentRepository: EmployeeDocumentRepository,
    private readonly employeeRepository: EmployeeRepository,
    @Inject(FILE_STORAGE) private readonly fileStorage: FileStorage,
  ) {}

  list(organisationId: string, employeeId: string): Promise<EmployeeDocument[]> {
    return this.employeeDocumentRepository.findManyByEmployee(organisationId, employeeId);
  }

  async add(
    organisationId: string,
    employeeId: string,
    documentType: EmployeeDocumentType,
    name: string,
    description: string | undefined,
    issuedDate: Date | undefined,
    expiryDate: Date | undefined,
    file: { mimeType: string; buffer: Buffer },
    actorUserId: string,
  ): Promise<EmployeeDocument> {
    const employee = await this.employeeRepository.findById(organisationId, employeeId);
    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    const uploaded = await this.fileStorage.upload({
      organisationId,
      folder: 'employee-documents',
      mimeType: file.mimeType,
      buffer: file.buffer,
    });

    return this.employeeDocumentRepository.create({
      organisationId,
      employeeId,
      documentType,
      name,
      description,
      url: uploaded.url,
      key: uploaded.key,
      issuedDate,
      expiryDate,
      uploadedByUserId: actorUserId,
    });
  }

  async update(
    organisationId: string,
    employeeId: string,
    documentId: string,
    input: UpdateEmployeeDocumentInput,
  ): Promise<EmployeeDocument> {
    const document = await this.employeeDocumentRepository.findById(organisationId, documentId);
    if (!document || document.employeeId !== employeeId) {
      throw new NotFoundException('Employee document not found');
    }
    const updated = await this.employeeDocumentRepository.update(organisationId, documentId, {
      name: input.name,
      description: input.description,
      issuedDate: input.issuedDate,
      expiryDate: input.expiryDate,
      status: input.status,
    });
    if (!updated) {
      throw new NotFoundException('Employee document not found');
    }
    return updated;
  }
}
