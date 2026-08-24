import { CreditNoteStatus, InvoiceStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import {
  CreditNoteInvoiceConflictError,
  CreditNoteNotFoundError,
  CreditNoteRepository,
  CreditNoteStateError,
  OverCreditError,
} from './credit-note.repository';

/**
 * A deliberate exception to this codebase's "no repository-level unit tests for atomic
 * transactions" convention (see `payment.repository.spec.ts`'s own doc comment for the
 * full rationale). Exercises `CreditNoteRepository.issue()`/`.void()`'s actual
 * transaction-callback logic against a small in-memory fake of `invoice`/`creditNote`.
 */
function makeFakeTx(
  invoices: Map<string, Record<string, unknown>>,
  creditNotes: Map<string, Record<string, unknown>>,
) {
  return {
    creditNote: {
      findFirst: jest.fn(async ({ where }: { where: { id: string; organisationId?: string } }) => {
        const creditNote = creditNotes.get(where.id);
        if (!creditNote) return null;
        if (where.organisationId && creditNote.organisationId !== where.organisationId) return null;
        return creditNote;
      }),
      update: jest.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const creditNote = creditNotes.get(where.id);
          if (!creditNote) throw new Error('credit note not found');
          Object.assign(creditNote, data);
          return creditNote;
        },
      ),
    },
    invoice: {
      findFirst: jest.fn(
        async ({
          where,
        }: {
          where: {
            id: string;
            organisationId?: string;
            customerId?: string;
            status?: { in: InvoiceStatus[] };
          };
        }) => {
          const invoice = invoices.get(where.id);
          if (!invoice) return null;
          if (where.organisationId && invoice.organisationId !== where.organisationId) return null;
          if (where.customerId && invoice.customerId !== where.customerId) return null;
          if (where.status?.in && !where.status.in.includes(invoice.status as InvoiceStatus))
            return null;
          return invoice;
        },
      ),
      findUniqueOrThrow: jest.fn(async ({ where }: { where: { id: string } }) => {
        const invoice = invoices.get(where.id);
        if (!invoice) throw new Error('invoice not found');
        return invoice;
      }),
      update: jest.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const invoice = invoices.get(where.id);
          if (!invoice) throw new Error('invoice not found');
          Object.assign(invoice, data);
          return invoice;
        },
      ),
    },
  };
}

function makePrisma(
  invoices: Map<string, Record<string, unknown>>,
  creditNotes: Map<string, Record<string, unknown>>,
) {
  const tx = makeFakeTx(invoices, creditNotes);
  return {
    $transaction: jest.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(tx)),
  } as unknown as PrismaService;
}

function makeInvoice(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'invoice-2',
    organisationId: 'org-1',
    customerId: 'customer-1',
    currency: 'NGN',
    status: InvoiceStatus.PARTIALLY_PAID,
    total: 2_500_000,
    amountPaid: 1_000_000,
    amountCredited: 0,
    ...overrides,
  };
}

function makeCreditNote(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'credit-note-1',
    organisationId: 'org-1',
    customerId: 'customer-1',
    invoiceId: 'invoice-2',
    amount: 250_000,
    status: CreditNoteStatus.DRAFT,
    ...overrides,
  };
}

describe('CreditNoteRepository (deliberate exception — real transaction logic under test)', () => {
  it('issues a credit note within the outstanding balance and recomputes invoice status', async () => {
    const invoices = new Map([['invoice-2', makeInvoice()]]);
    const creditNotes = new Map([['credit-note-1', makeCreditNote()]]);
    const repository = new CreditNoteRepository(makePrisma(invoices, creditNotes));

    const result = await repository.issue('org-1', 'credit-note-1', 'user-1');

    expect(result.creditNote.status).toBe(CreditNoteStatus.ISSUED);
    expect(invoices.get('invoice-2')!.amountCredited).toBe(250_000);
    // 1,000,000 paid + 250,000 credited = 1,250,000 < 2,500,000 total -> still PARTIALLY_PAID
    expect(invoices.get('invoice-2')!.status).toBe(InvoiceStatus.PARTIALLY_PAID);
  });

  it('landing exactly on the outstanding boundary via payment+credit marks the invoice PAID', async () => {
    // 1,000,000 paid already; crediting the remaining 1,500,000 should fully settle it.
    const invoices = new Map([['invoice-2', makeInvoice({ amountPaid: 1_000_000 })]]);
    const creditNotes = new Map([['credit-note-1', makeCreditNote({ amount: 1_500_000 })]]);
    const repository = new CreditNoteRepository(makePrisma(invoices, creditNotes));

    const result = await repository.issue('org-1', 'credit-note-1', 'user-1');

    expect(result.creditNote.status).toBe(CreditNoteStatus.ISSUED);
    expect(invoices.get('invoice-2')!.status).toBe(InvoiceStatus.PAID);
  });

  it('rejects a credit note exceeding the outstanding balance by exactly 0.01', async () => {
    const invoices = new Map([['invoice-2', makeInvoice({ amountPaid: 1_000_000 })]]);
    const creditNotes = new Map([['credit-note-1', makeCreditNote({ amount: 1_500_000.01 })]]);
    const repository = new CreditNoteRepository(makePrisma(invoices, creditNotes));

    await expect(repository.issue('org-1', 'credit-note-1', 'user-1')).rejects.toThrow(
      OverCreditError,
    );
  });

  it('rejects issuing an already-issued credit note', async () => {
    const invoices = new Map([['invoice-2', makeInvoice()]]);
    const creditNotes = new Map([
      ['credit-note-1', makeCreditNote({ status: CreditNoteStatus.ISSUED })],
    ]);
    const repository = new CreditNoteRepository(makePrisma(invoices, creditNotes));

    await expect(repository.issue('org-1', 'credit-note-1', 'user-1')).rejects.toThrow(
      CreditNoteStateError,
    );
  });

  it('rejects issuing against a non-payable (VOID) invoice', async () => {
    const invoices = new Map([['invoice-2', makeInvoice({ status: InvoiceStatus.VOID })]]);
    const creditNotes = new Map([['credit-note-1', makeCreditNote()]]);
    const repository = new CreditNoteRepository(makePrisma(invoices, creditNotes));

    await expect(repository.issue('org-1', 'credit-note-1', 'user-1')).rejects.toThrow(
      CreditNoteInvoiceConflictError,
    );
  });

  it('throws CreditNoteNotFoundError for an unknown/cross-tenant credit note', async () => {
    const invoices = new Map<string, Record<string, unknown>>();
    const creditNotes = new Map<string, Record<string, unknown>>();
    const repository = new CreditNoteRepository(makePrisma(invoices, creditNotes));

    await expect(repository.issue('org-1', 'unknown', 'user-1')).rejects.toThrow(
      CreditNoteNotFoundError,
    );
  });

  it('void() reverses an issued credit note and recomputes invoice status back down', async () => {
    const invoices = new Map([
      ['invoice-2', makeInvoice({ amountCredited: 250_000, status: InvoiceStatus.PARTIALLY_PAID })],
    ]);
    const creditNotes = new Map([
      ['credit-note-1', makeCreditNote({ status: CreditNoteStatus.ISSUED })],
    ]);
    const repository = new CreditNoteRepository(makePrisma(invoices, creditNotes));

    const result = await repository.void('org-1', 'credit-note-1', 'user-1');

    expect(result).not.toBeNull();
    expect(result!.creditNote.status).toBe(CreditNoteStatus.VOID);
    expect(invoices.get('invoice-2')!.amountCredited).toBe(0);
  });

  it('never lets amountCredited go negative when voiding', async () => {
    const invoices = new Map([['invoice-2', makeInvoice({ amountCredited: 0 })]]);
    const creditNotes = new Map([
      ['credit-note-1', makeCreditNote({ status: CreditNoteStatus.ISSUED, amount: 250_000 })],
    ]);
    const repository = new CreditNoteRepository(makePrisma(invoices, creditNotes));

    await repository.void('org-1', 'credit-note-1', 'user-1');

    expect(invoices.get('invoice-2')!.amountCredited).toBe(0);
  });

  it('rejects voiding an already-void credit note', async () => {
    const invoices = new Map([['invoice-2', makeInvoice()]]);
    const creditNotes = new Map([
      ['credit-note-1', makeCreditNote({ status: CreditNoteStatus.VOID })],
    ]);
    const repository = new CreditNoteRepository(makePrisma(invoices, creditNotes));

    await expect(repository.void('org-1', 'credit-note-1', 'user-1')).rejects.toThrow(
      CreditNoteStateError,
    );
  });
});
