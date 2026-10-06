import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Sprint 35's central architectural guarantee, verified executably rather
 * than just documented (docs/domains/d2c.md "Payment Architecture"):
 * `D2CPaymentService` reuses the EXISTING `Payment`/`SalesOrder` domains
 * rather than duplicating either, never creates a `Payment`/`SalesOrder`
 * row itself (it always delegates to `PaymentService`/`SalesOrderService`),
 * never writes a journal entry or touches Finance's accounting tables
 * directly, and contains no OPay-specific wire-format code (that lives
 * entirely in `payments/infrastructure/opay-payment-provider.ts`, behind
 * the `PaymentProvider` port). Mirrors
 * `d2c-ordering-independence.spec.ts`'s exact technique (Sprint 34).
 */
describe('D2C Payment domain independence (Sprint 35)', () => {
  function readSource(fileName: string): string {
    return readFileSync(join(__dirname, fileName), 'utf-8');
  }

  const PAYMENT_FILES = [
    'd2c-payment.types.ts',
    'd2c-payment-audit-actions.ts',
    'd2c-payment.service.ts',
  ];

  it('structural guard: D2CPaymentService never writes to Payment/SalesOrder/JournalEntry tables directly — every mutation goes through PaymentService/SalesOrderService', () => {
    const source = readSource('d2c-payment.service.ts');
    expect(source).not.toMatch(
      /this\.(prisma)\.(payment|salesOrder|journalEntry)\.(create|update|updateMany|delete|deleteMany|upsert|createMany)\(/,
    );
    expect(source).not.toMatch(/PaymentRepository|SalesOrderRepository|postSystemJournalEntry/);
    expect(source).toMatch(
      /this\.paymentService\.(createPendingForConsumer|applyProviderCallback)\(/,
    );
    expect(source).toMatch(/this\.salesOrderService\.confirm\(/);
  });

  it('structural guard: no OPay-specific wire-format code exists outside the payments/ provider — D2CPaymentService only ever sees the neutral PaymentProvider contract', () => {
    for (const fileName of PAYMENT_FILES) {
      const source = readSource(fileName);
      expect(source).not.toMatch(/cashierUrl|orderNo|OPAY_ERROR_CODES|international\/cashier/);
      expect(source).not.toMatch(/\bclass\s+\w*Opay\w*/);
    }
  });

  it('structural guard: no ordering file imports Catalogue/Production/Distribution/Inventory/Procurement/Suppliers/Assets/Maintenance/HR/Workflow/Notifications — its only cross-domain dependencies are Finance (Payment), Sales (SalesOrder), and D2C Consumer', () => {
    for (const fileName of PAYMENT_FILES) {
      const source = readSource(fileName);
      expect(source).not.toMatch(/from ['"].*\bcatalogue\//);
      expect(source).not.toMatch(/from ['"].*\bproduction\//);
      expect(source).not.toMatch(/from ['"].*\bdistribution\//);
      expect(source).not.toMatch(/from ['"].*\binventory\//);
      expect(source).not.toMatch(/from ['"].*\bprocurement\//);
      expect(source).not.toMatch(/from ['"].*\bsuppliers\//);
      expect(source).not.toMatch(/from ['"].*\bassets\//);
      expect(source).not.toMatch(/from ['"].*\bmaintenance\//);
      expect(source).not.toMatch(/from ['"].*\bhr\//);
      expect(source).not.toMatch(/from ['"].*\bworkflow\//);
      expect(source).not.toMatch(/from ['"].*\bnotifications\//);
    }
  });

  it('structural guard: never logs, returns, or embeds the OPay secret/public key — D2CPaymentService has no OPAY_SECRET_KEY/OPAY_PUBLIC_KEY reference at all (config lives only in the provider)', () => {
    for (const fileName of PAYMENT_FILES) {
      const source = readSource(fileName);
      expect(source).not.toMatch(/OPAY_SECRET_KEY|OPAY_PUBLIC_KEY|secretKey|publicKey/);
    }
  });

  it('structural guard: D2CPaymentModule imports only PaymentProviderModule/FinanceModule/SalesModule/ConsumerModule/IdentityModule/CollectionPointFulfillmentModule/RewardModule, no controller', () => {
    const source = readFileSync(join(__dirname, 'd2c-payment.module.ts'), 'utf-8');
    expect(source).not.toMatch(/controllers:/);
    const importsMatch = source.match(/imports:\s*\[([\s\S]*?)\],\s*providers/);
    expect(importsMatch).not.toBeNull();
    const importedModules = [...(importsMatch![1] ?? '').matchAll(/\b(\w+Module)\b/g)].map(
      (m) => m[1],
    );
    expect(new Set(importedModules)).toEqual(
      new Set([
        'PaymentProviderModule',
        'FinanceModule',
        'SalesModule',
        'ConsumerModule',
        'IdentityModule',
        // Added Sprint 37 — best-effort Collection Point auto-assignment right after a
        // verified payment (docs/domains/d2c.md "Order Assignment Model").
        'CollectionPointFulfillmentModule',
        // Added Sprint 40 — best-effort promotion evaluation right alongside Collection
        // Point auto-assignment (docs/domains/d2c.md "Qualifying Events").
        'RewardModule',
      ]),
    );
  });
});
