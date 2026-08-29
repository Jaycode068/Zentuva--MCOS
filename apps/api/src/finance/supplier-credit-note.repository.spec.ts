import { CreditNoteStatus, SupplierInvoiceStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import {
  CreditNoteInvoiceConflictError,
  CreditNoteNotFoundError,
  CreditNoteStateError,
  OverCreditError,
  SupplierCreditNoteRepository,
} from './supplier-credit-note.repository';

/**
 * A deliberate exception to this codebase's "no repository-level unit tests for atomic
 * transactions" convention — same justification as `credit-note.repository.spec.ts`.
 * Verifies `SupplierCreditNoteRepository.issue()`/`.void()`'s real transaction logic,
 * posting `DR Accounts Payable / CR Inventory` and bounding the credit against
 * `recognizedAmount`, never `total`.
 */
function makeFakeTx(
  supplierInvoices: Map<string, Record<string, unknown>>,
  supplierCreditNotes: Map<string, Record<string, unknown>>,
  journalEntries: Map<string, Record<string, unknown>> = new Map(),
) {
  let journalSequence = 0;
  return {
    chartOfAccount: {
      findFirst: jest.fn(
        async ({ where }: { where: { organisationId: string; systemKey: string } }) => ({
          id: `account-${where.systemKey}`,
          organisationId: where.organisationId,
          systemKey: where.systemKey,
        }),
      ),
    },
    accountingPeriod: {
      findFirst: jest.fn(async () => ({ id: 'period-1', status: 'OPEN' })),
    },
    journalEntry: {
      findUnique: jest.fn(
        async ({
          where,
        }: {
          where: {
            organisationId_sourceType_sourceId?: {
              organisationId: string;
              sourceType: string;
              sourceId: string;
            };
          };
        }) => {
          const key = where.organisationId_sourceType_sourceId;
          if (!key) return null;
          for (const entry of journalEntries.values()) {
            if (
              entry.organisationId === key.organisationId &&
              entry.sourceType === key.sourceType &&
              entry.sourceId === key.sourceId
            ) {
              return entry;
            }
          }
          return null;
        },
      ),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        journalSequence += 1;
        const id = `journal-${journalSequence}`;
        const entry = { id, ...data };
        journalEntries.set(id, entry);
        return entry;
      }),
    },
    supplierCreditNote: {
      findFirst: jest.fn(async ({ where }: { where: { id: string; organisationId?: string } }) => {
        const creditNote = supplierCreditNotes.get(where.id);
        if (!creditNote) return null;
        if (where.organisationId && creditNote.organisationId !== where.organisationId) return null;
        return creditNote;
      }),
      update: jest.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const creditNote = supplierCreditNotes.get(where.id);
          if (!creditNote) throw new Error('supplier credit note not found');
          Object.assign(creditNote, data);
          return {
            ...creditNote,
            supplier: {
              id: creditNote.supplierId,
              supplierCode: 'SUP-000004',
              supplierName: 'Label Masters',
            },
            supplierInvoice: creditNote.supplierInvoiceId
              ? { id: creditNote.supplierInvoiceId, invoiceNumber: 'INV-0001' }
              : null,
          };
        },
      ),
    },
    supplierInvoice: {
      findFirst: jest.fn(
        async ({
          where,
        }: {
          where: {
            id: string;
            organisationId?: string;
            supplierId?: string;
            status?: { in: SupplierInvoiceStatus[] };
          };
        }) => {
          const invoice = supplierInvoices.get(where.id);
          if (!invoice) return null;
          if (where.organisationId && invoice.organisationId !== where.organisationId) return null;
          if (where.supplierId && invoice.supplierId !== where.supplierId) return null;
          if (
            where.status?.in &&
            !where.status.in.includes(invoice.status as SupplierInvoiceStatus)
          ) {
            return null;
          }
          return invoice;
        },
      ),
      findUniqueOrThrow: jest.fn(async ({ where }: { where: { id: string } }) => {
        const invoice = supplierInvoices.get(where.id);
        if (!invoice) throw new Error('supplier invoice not found');
        return invoice;
      }),
      update: jest.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const invoice = supplierInvoices.get(where.id);
          if (!invoice) throw new Error('supplier invoice not found');
          Object.assign(invoice, data);
          return invoice;
        },
      ),
    },
  };
}

function makePrisma(
  supplierInvoices: Map<string, Record<string, unknown>>,
  supplierCreditNotes: Map<string, Record<string, unknown>>,
  journalEntries: Map<string, Record<string, unknown>> = new Map(),
) {
  const tx = makeFakeTx(supplierInvoices, supplierCreditNotes, journalEntries);
  return {
    $transaction: jest.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(tx)),
  } as unknown as PrismaService;
}

function makeSupplierInvoice(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'sinv-1',
    organisationId: 'org-1',
    supplierId: 'supplier-1',
    invoiceNumber: 'INV-0001',
    status: SupplierInvoiceStatus.POSTED,
    total: 1_000_000,
    recognizedAmount: 1_000_000,
    amountPaid: 0,
    amountCredited: 0,
    ...overrides,
  };
}

function makeCreditNote(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'scn-1',
    organisationId: 'org-1',
    supplierId: 'supplier-1',
    supplierInvoiceId: 'sinv-1',
    creditNoteCode: 'SCN-0001',
    creditNoteDate: new Date('2026-08-25'),
    status: CreditNoteStatus.DRAFT,
    amount: 100_000,
    ...overrides,
  };
}

describe('SupplierCreditNoteRepository (deliberate exception — real transaction logic under test)', () => {
  it('issue() posts DR Accounts Payable / CR Inventory and reduces the invoice outstanding balance', async () => {
    const supplierInvoices = new Map([['sinv-1', makeSupplierInvoice()]]);
    const supplierCreditNotes = new Map([['scn-1', makeCreditNote()]]);
    const journalEntries = new Map<string, Record<string, unknown>>();
    const repository = new SupplierCreditNoteRepository(
      makePrisma(supplierInvoices, supplierCreditNotes, journalEntries),
    );

    const result = await repository.issue('org-1', 'scn-1', 'user-1');

    expect(result.creditNote.status).toBe(CreditNoteStatus.ISSUED);
    expect(supplierInvoices.get('sinv-1')!.amountCredited).toBe(100_000);
    expect(supplierInvoices.get('sinv-1')!.status).toBe(SupplierInvoiceStatus.PARTIALLY_PAID);
    const entry = [...journalEntries.values()][0]! as {
      lines: { create: { accountId: string; debit: number; credit: number }[] };
    };
    expect(entry.lines.create).toEqual([
      { accountId: 'account-AP', description: undefined, debit: 100_000, credit: 0 },
      { accountId: 'account-INVENTORY', description: undefined, debit: 0, credit: 100_000 },
    ]);
  });

  it('rejects crediting more than the invoice’s outstanding recognizedAmount', async () => {
    const supplierInvoices = new Map([
      ['sinv-1', makeSupplierInvoice({ recognizedAmount: 100_000 })],
    ]);
    const supplierCreditNotes = new Map([['scn-1', makeCreditNote({ amount: 150_000 })]]);
    const repository = new SupplierCreditNoteRepository(
      makePrisma(supplierInvoices, supplierCreditNotes),
    );

    await expect(repository.issue('org-1', 'scn-1', 'user-1')).rejects.toThrow(OverCreditError);
  });

  it('rejects issuing against an invoice not in a creditable status', async () => {
    const supplierInvoices = new Map([
      ['sinv-1', makeSupplierInvoice({ status: SupplierInvoiceStatus.DRAFT })],
    ]);
    const supplierCreditNotes = new Map([['scn-1', makeCreditNote()]]);
    const repository = new SupplierCreditNoteRepository(
      makePrisma(supplierInvoices, supplierCreditNotes),
    );

    await expect(repository.issue('org-1', 'scn-1', 'user-1')).rejects.toThrow(
      CreditNoteInvoiceConflictError,
    );
  });

  it('rejects issuing a credit note that is not DRAFT', async () => {
    const supplierInvoices = new Map([['sinv-1', makeSupplierInvoice()]]);
    const supplierCreditNotes = new Map([
      ['scn-1', makeCreditNote({ status: CreditNoteStatus.ISSUED })],
    ]);
    const repository = new SupplierCreditNoteRepository(
      makePrisma(supplierInvoices, supplierCreditNotes),
    );

    await expect(repository.issue('org-1', 'scn-1', 'user-1')).rejects.toThrow(
      CreditNoteStateError,
    );
  });

  it('rejects issuing a nonexistent/cross-tenant credit note', async () => {
    const supplierInvoices = new Map([['sinv-1', makeSupplierInvoice()]]);
    const supplierCreditNotes = new Map<string, Record<string, unknown>>();
    const repository = new SupplierCreditNoteRepository(
      makePrisma(supplierInvoices, supplierCreditNotes),
    );

    await expect(repository.issue('org-1', 'unknown', 'user-1')).rejects.toThrow(
      CreditNoteNotFoundError,
    );
  });

  it('void() reverses an issued credit note’s effect on the invoice', async () => {
    const supplierInvoices = new Map([
      [
        'sinv-1',
        makeSupplierInvoice({
          amountCredited: 100_000,
          status: SupplierInvoiceStatus.PARTIALLY_PAID,
        }),
      ],
    ]);
    const supplierCreditNotes = new Map([
      ['scn-1', makeCreditNote({ status: CreditNoteStatus.ISSUED })],
    ]);
    const repository = new SupplierCreditNoteRepository(
      makePrisma(supplierInvoices, supplierCreditNotes),
    );

    const result = await repository.void('org-1', 'scn-1', 'user-1');

    expect(result!.creditNote.status).toBe(CreditNoteStatus.VOID);
    expect(supplierInvoices.get('sinv-1')!.amountCredited).toBe(0);
    expect(supplierInvoices.get('sinv-1')!.status).toBe(SupplierInvoiceStatus.POSTED);
  });

  it('rejects voiding an already-voided credit note', async () => {
    const supplierInvoices = new Map([['sinv-1', makeSupplierInvoice()]]);
    const supplierCreditNotes = new Map([
      ['scn-1', makeCreditNote({ status: CreditNoteStatus.VOID })],
    ]);
    const repository = new SupplierCreditNoteRepository(
      makePrisma(supplierInvoices, supplierCreditNotes),
    );

    await expect(repository.void('org-1', 'scn-1', 'user-1')).rejects.toThrow(CreditNoteStateError);
  });

  it('returns null when voiding a nonexistent/cross-tenant credit note', async () => {
    const supplierInvoices = new Map([['sinv-1', makeSupplierInvoice()]]);
    const supplierCreditNotes = new Map<string, Record<string, unknown>>();
    const repository = new SupplierCreditNoteRepository(
      makePrisma(supplierInvoices, supplierCreditNotes),
    );

    expect(await repository.void('org-1', 'unknown', 'user-1')).toBeNull();
  });
});
