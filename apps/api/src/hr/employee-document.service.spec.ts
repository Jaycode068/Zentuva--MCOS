import { NotFoundException } from '@nestjs/common';

import { EmployeeDocumentService } from './employee-document.service';

const ORG = 'org-1';
const OTHER_ORG = 'org-2';

function makeDocument(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'doc-1',
    organisationId: ORG,
    employeeId: 'emp-1',
    documentType: 'IDENTIFICATION',
    name: 'National ID',
    url: 'https://files.example/doc-1',
    key: 'employee-documents/org-1/doc-1',
    status: 'ACTIVE',
    ...overrides,
  };
}

function makeService(options?: {
  employees?: Record<string, Record<string, unknown>>;
  documents?: Record<string, Record<string, unknown>>;
}) {
  const employees: Record<string, Record<string, unknown>> = options?.employees ?? {
    'emp-1': { id: 'emp-1', organisationId: ORG },
  };
  const documents: Record<string, Record<string, unknown>> = options?.documents ?? {
    'doc-1': makeDocument(),
  };

  const employeeDocumentRepository = {
    findById: jest.fn(async (org: string, id: string) => {
      const d = documents[id];
      return d && d.organisationId === org ? d : null;
    }),
    findManyByEmployee: jest.fn(async (org: string, employeeId: string) =>
      Object.values(documents).filter(
        (d) => d.organisationId === org && d.employeeId === employeeId,
      ),
    ),
    create: jest.fn(async (data: Record<string, unknown>) => ({
      ...makeDocument(),
      ...data,
      id: 'doc-new',
    })),
    update: jest.fn(async (org: string, id: string, data: Record<string, unknown>) => {
      const d = documents[id];
      if (!d || d.organisationId !== org) return null;
      return { ...d, ...data };
    }),
  };

  const employeeRepository = {
    findById: jest.fn(async (org: string, id: string) => {
      const e = employees[id];
      return e && e.organisationId === org ? e : null;
    }),
  };

  const fileStorage = {
    upload: jest.fn(async () => ({
      url: 'https://files.example/new',
      key: 'employee-documents/x',
    })),
    delete: jest.fn(async () => undefined),
  };

  const service = new EmployeeDocumentService(
    employeeDocumentRepository as never,
    employeeRepository as never,
    fileStorage as never,
  );
  return { service, employeeDocumentRepository, employeeRepository, fileStorage };
}

describe('EmployeeDocumentService', () => {
  it('add(): creates document metadata for a valid employee, uploading via the shared FileStorage port', async () => {
    const { service, fileStorage, employeeDocumentRepository } = makeService();
    const doc = await service.add(
      ORG,
      'emp-1',
      'IDENTIFICATION',
      'National ID',
      undefined,
      undefined,
      undefined,
      { mimeType: 'image/png', buffer: Buffer.from('x') },
      'user-1',
    );
    expect(fileStorage.upload).toHaveBeenCalledWith(
      expect.objectContaining({ organisationId: ORG, folder: 'employee-documents' }),
    );
    expect(employeeDocumentRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ employeeId: 'emp-1', documentType: 'IDENTIFICATION' }),
    );
    expect(doc.name).toBe('National ID');
  });

  it('add(): rejects attaching a document to a non-existent employee', async () => {
    const { service } = makeService({ employees: {} });
    await expect(
      service.add(
        ORG,
        'emp-missing',
        'OTHER',
        'Doc',
        undefined,
        undefined,
        undefined,
        { mimeType: 'image/png', buffer: Buffer.from('x') },
        'user-1',
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('tenant isolation: cannot attach a document to an employee in a different organisation', async () => {
    const { service } = makeService();
    await expect(
      service.add(
        OTHER_ORG,
        'emp-1',
        'OTHER',
        'Doc',
        undefined,
        undefined,
        undefined,
        { mimeType: 'image/png', buffer: Buffer.from('x') },
        'user-1',
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('update(): safely updates metadata for a document that belongs to this employee', async () => {
    const { service } = makeService();
    const updated = await service.update(ORG, 'emp-1', 'doc-1', { name: 'Updated Name' } as never);
    expect(updated.name).toBe('Updated Name');
  });

  it('update(): rejects updating a document that belongs to a different employee (no cross-employee access)', async () => {
    const documents = { 'doc-1': makeDocument({ employeeId: 'emp-2' }) };
    const { service } = makeService({ documents });
    await expect(
      service.update(ORG, 'emp-1', 'doc-1', { name: 'Hacked' } as never),
    ).rejects.toThrow(NotFoundException);
  });

  it('tenant isolation: update() cannot reach a document in a different organisation', async () => {
    const { service } = makeService();
    await expect(
      service.update(OTHER_ORG, 'emp-1', 'doc-1', { name: 'Hacked' } as never),
    ).rejects.toThrow(NotFoundException);
  });
});
