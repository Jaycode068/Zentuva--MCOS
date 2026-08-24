import { JournalEntry, JournalEntryStatus, Prisma } from '@prisma/client';

const JOURNAL_NUMBER_PREFIX = 'JE';
const JOURNAL_NUMBER_SEQUENCE_LENGTH = 6;

/** Thrown when an organisation has no `ChartOfAccount` marked with the requested
 *  `systemKey` — a posting can never silently skip a leg or fall back to a guess. */
export class MissingSystemAccountError extends Error {}

/** Thrown when no `OPEN` `AccountingPeriod` covers the journal's date (either no
 *  period exists for that date, or the covering period is `CLOSED`). Thrown from
 *  inside the caller's own `$transaction` — the whole business operation (invoice
 *  issuance, payment recording, credit note issuing) rolls back with it, satisfying
 *  the brief's atomicity requirement: there is never an Invoice marked `ISSUED` with
 *  no journal behind it. */
export class NoOpenPeriodError extends Error {}

/** Thrown when a posting's lines don't balance — defensive only; every call site in
 *  this codebase constructs pre-balanced two-line sets, so this should never actually
 *  fire outside a test double. */
export class UnbalancedPostingError extends Error {}

export interface PostingLineInput {
  systemKey: string;
  debit?: number;
  credit?: number;
  description?: string;
}

export interface PostSystemJournalEntryInput {
  organisationId: string;
  date: Date;
  description: string;
  reference?: string;
  sourceType: string;
  sourceId: string;
  lines: PostingLineInput[];
  actorUserId?: string;
}

export interface PostSystemJournalEntryResult {
  journalEntry: JournalEntry;
  /** `true` only when this call created a new row; `false` when an existing
   *  `(sourceType, sourceId)` match was returned instead — the caller uses this to
   *  skip re-emitting an audit event on a replay, same convention as `wasCreated` on
   *  `PaymentRepository.create()`. */
  wasCreated: boolean;
}

/**
 * Resolves "the AR account for this organisation" (etc.) without ever hardcoding an
 * id — see `SYSTEM_ACCOUNT_KEYS`. Runs inside the caller's own transaction so the
 * lookup is consistent with whatever else that transaction is doing.
 */
export async function resolveSystemAccountId(
  tx: Prisma.TransactionClient,
  organisationId: string,
  systemKey: string,
): Promise<string> {
  const account = await tx.chartOfAccount.findFirst({
    where: { organisationId, systemKey },
    select: { id: true },
  });
  if (!account) {
    throw new MissingSystemAccountError(
      `No "${systemKey}" system account is configured for this organisation`,
    );
  }
  return account.id;
}

/** The `OPEN` period whose `[startDate, endDate]` (both inclusive) contains `date` —
 *  throws if none exists or the covering period is `CLOSED`. */
export async function resolveOpenPeriodId(
  tx: Prisma.TransactionClient,
  organisationId: string,
  date: Date,
): Promise<string> {
  const period = await tx.accountingPeriod.findFirst({
    where: { organisationId, status: 'OPEN', startDate: { lte: date }, endDate: { gte: date } },
    select: { id: true },
  });
  if (!period) {
    throw new NoOpenPeriodError(
      `No open accounting period covers ${date.toISOString().slice(0, 10)}`,
    );
  }
  return period.id;
}

/** `JE-000001`, `JE-000002`, ... — unique per organisation (unlike `Invoice.invoiceCode`,
 *  which is global). Runs inside the caller's transaction, using `tx.journalEntry.count`
 *  as the collision-avoidance loop's uniqueness check — same shape as every other
 *  `<PREFIX>-000001` generator in this codebase, just safely inside the transaction
 *  that will also perform the write instead of racing a separate pre-check. */
async function generateJournalNumber(
  tx: Prisma.TransactionClient,
  organisationId: string,
): Promise<string> {
  let sequence = 1;
  let candidate = formatJournalNumber(sequence);
  while (
    await tx.journalEntry.findUnique({
      where: { organisationId_journalNumber: { organisationId, journalNumber: candidate } },
      select: { id: true },
    })
  ) {
    sequence += 1;
    candidate = formatJournalNumber(sequence);
  }
  return candidate;
}

function formatJournalNumber(sequence: number): string {
  return `${JOURNAL_NUMBER_PREFIX}-${String(sequence).padStart(JOURNAL_NUMBER_SEQUENCE_LENGTH, '0')}`;
}

/**
 * Posts a system-generated (`status: POSTED` directly, no `DRAFT` interval) journal
 * entry for a Finance business event — `PaymentRepository.create()`,
 * `CreditNoteRepository.issue()`, and `InvoiceRepository.issue()` all call this from
 * *inside their own* `$transaction`, passing that transaction's `tx` client, so the
 * posting is atomic with the write that caused it (docs/domains/accounting.md
 * "Accounting Posting Boundary").
 *
 * Idempotent on `(organisationId, sourceType, sourceId)` — a retried event (e.g. a
 * duplicate webhook, a flaky-network retry) can never produce a second journal for the
 * same source.
 */
export async function postSystemJournalEntry(
  tx: Prisma.TransactionClient,
  input: PostSystemJournalEntryInput,
): Promise<PostSystemJournalEntryResult> {
  const existing = await tx.journalEntry.findUnique({
    where: {
      organisationId_sourceType_sourceId: {
        organisationId: input.organisationId,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
      },
    },
  });
  if (existing) {
    return { journalEntry: existing, wasCreated: false };
  }

  const totalDebit = roundCurrency(input.lines.reduce((sum, line) => sum + (line.debit ?? 0), 0));
  const totalCredit = roundCurrency(input.lines.reduce((sum, line) => sum + (line.credit ?? 0), 0));
  if (totalDebit !== totalCredit) {
    throw new UnbalancedPostingError(
      `Posting for ${input.sourceType} ${input.sourceId} does not balance (debit ${totalDebit} vs credit ${totalCredit})`,
    );
  }

  const accountingPeriodId = await resolveOpenPeriodId(tx, input.organisationId, input.date);
  const journalNumber = await generateJournalNumber(tx, input.organisationId);

  const lines = await Promise.all(
    input.lines.map(async (line) => ({
      accountId: await resolveSystemAccountId(tx, input.organisationId, line.systemKey),
      description: line.description,
      debit: roundCurrency(line.debit ?? 0),
      credit: roundCurrency(line.credit ?? 0),
    })),
  );

  const journalEntry = await tx.journalEntry.create({
    data: {
      organisationId: input.organisationId,
      journalNumber,
      date: input.date,
      accountingPeriodId,
      description: input.description,
      reference: input.reference,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      status: JournalEntryStatus.POSTED,
      postedAt: new Date(),
      createdById: input.actorUserId,
      lines: { create: lines },
    },
  });

  return { journalEntry, wasCreated: true };
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}
