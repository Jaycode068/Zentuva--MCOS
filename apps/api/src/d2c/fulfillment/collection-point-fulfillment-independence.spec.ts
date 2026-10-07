import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Sprint 37's central architectural guarantee, verified executably rather than just
 * documented (docs/domains/d2c.md "Inventory Mutation Boundary"):
 * `CollectionPointFulfillmentService` never deducts inventory itself, never writes to
 * `SalesOrder`/`InventoryStock`/`InventoryTransaction` directly, and always delegates the
 * one actual inventory-moving write to the EXISTING, unmodified
 * `SalesFulfilmentService.fulfil()`. Mirrors `d2c-payment-independence.spec.ts`'s exact
 * technique (Sprint 35).
 */
describe('Collection Point Fulfillment domain independence (Sprint 37)', () => {
  function readSource(fileName: string): string {
    return readFileSync(join(__dirname, fileName), 'utf-8');
  }

  const FULFILLMENT_FILES = [
    'collection-point-fulfillment.types.ts',
    'collection-point-fulfillment-audit-actions.ts',
    'collection-point-fulfillment.service.ts',
  ];

  it('structural guard: never writes to SalesOrder/InventoryStock/InventoryTransaction directly — every inventory mutation goes through SalesFulfilmentService.fulfil()', () => {
    const source = readSource('collection-point-fulfillment.service.ts');
    expect(source).not.toMatch(
      /this\.(prisma)\.(salesOrder|inventoryStock|inventoryTransaction)\.(create|update|updateMany|delete|deleteMany|upsert|createMany)\(/,
    );
    // Sprint 38 — InventoryStockRepository is now a legitimate, READ-ONLY dependency
    // (the Field Collection Point inventory view, `getInventoryViewForOutlet`, reusing
    // the exact `findManyByProductsAndLocation` primitive `SalesFulfilmentService
    // .getAvailability` already uses for B2B). The guard narrows to the thing that
    // actually matters — no WRITE method is ever called on it, and
    // InventoryTransactionRepository (a write-capable repository with no read need
    // here) still never appears at all.
    expect(source).not.toMatch(/InventoryTransactionRepository/);
    expect(source).not.toMatch(
      /this\.inventoryStockRepository\.(create|update|updateMany|delete|deleteMany|upsert|createMany)\(/,
    );
    expect(source).toMatch(/this\.salesFulfilmentService\.fulfil\(/);
  });

  it('structural guard: no new CollectionPoint/order/inventory entity name appears anywhere in this domain — subordinate to the EXISTING SalesOrder only', () => {
    for (const fileName of FULFILLMENT_FILES) {
      const source = readSource(fileName);
      expect(source).not.toMatch(
        /\bclass\s+\w*(ConsumerOrder|CollectionOrder|D2CFulfillmentOrder)\w*/,
      );
    }
  });

  it('structural guard: no forbidden cross-domain imports (Catalogue/Production/Distribution/Procurement/Suppliers/Assets/Maintenance/HR/Workflow/Notifications/Payments)', () => {
    for (const fileName of FULFILLMENT_FILES) {
      const source = readSource(fileName);
      expect(source).not.toMatch(/from ['"].*\bcatalogue\//);
      expect(source).not.toMatch(/from ['"].*\bproduction\//);
      expect(source).not.toMatch(/from ['"].*\bdistribution\//);
      expect(source).not.toMatch(/from ['"].*\bprocurement\//);
      expect(source).not.toMatch(/from ['"].*\bsuppliers\//);
      expect(source).not.toMatch(/from ['"].*\bassets\//);
      expect(source).not.toMatch(/from ['"].*\bmaintenance\//);
      expect(source).not.toMatch(/from ['"].*\bhr\//);
      expect(source).not.toMatch(/from ['"].*\bworkflow\//);
      expect(source).not.toMatch(/from ['"].*\bnotifications\//);
      expect(source).not.toMatch(/from ['"].*\bpayments\//);
      // Sprint 42 — consumer notifications go through the channel-neutral
      // ConsumerNotificationPort only (docs/domains/d2c.md "Fulfilment Notifications");
      // never a direct dependency on the WhatsApp webhook/adapter/test-controller layer.
      expect(source).not.toMatch(/from ['"].*\bd2c\/whatsapp\//);
      expect(source).not.toMatch(/WHATSAPP_PROVIDER|MetaWhatsAppProvider/);
    }
  });

  it('structural guard: no OPay/payment wire-format leakage anywhere in this domain — the Sprint 35 payment boundary is never crossed', () => {
    for (const fileName of FULFILLMENT_FILES) {
      const source = readSource(fileName);
      expect(source).not.toMatch(/OPAY_SECRET_KEY|OPAY_PUBLIC_KEY|cashierUrl|merchantReference/);
    }
  });

  it('structural guard: CollectionPointFulfillmentModule imports only IdentityModule/AuthModule/OutletModule/SalesModule/ConsumerModule/InventoryModule/D2CMessagingModule, no controller-less accident (it DOES have a controller — confirm exactly one)', () => {
    const source = readFileSync(join(__dirname, 'collection-point-fulfillment.module.ts'), 'utf-8');
    expect(source).toMatch(/controllers:\s*\[CollectionPointFulfillmentController\]/);
    const importsMatch = source.match(/imports:\s*\[([\s\S]*?)\],\s*controllers/);
    expect(importsMatch).not.toBeNull();
    const importedModules = [...(importsMatch![1] ?? '').matchAll(/\b(\w+Module)\b/g)].map(
      (m) => m[1],
    );
    // AuthModule is required alongside IdentityModule because the controller guards with
    // JwtAuthGuard, which needs TOKEN_SERVICE (provided by AuthModule, not IdentityModule) —
    // discovered via live verification when Nest failed to resolve JwtAuthGuard's dependency.
    // InventoryModule added Sprint 38 — the Field inventory view injects
    // InventoryStockRepository directly (OutletModule imports InventoryModule but does
    // not re-export it, so this module needs its own import). D2CMessagingModule added
    // Sprint 42 — the ONE narrow, channel-neutral CONSUMER_NOTIFICATION_PORT this service
    // calls at READY_FOR_COLLECTION/COLLECTED; never the full `notifications/` tree and
    // never anything WhatsApp-specific directly (still banned above).
    expect(new Set(importedModules)).toEqual(
      new Set([
        'IdentityModule',
        'AuthModule',
        'OutletModule',
        'SalesModule',
        'ConsumerModule',
        'InventoryModule',
        'D2CMessagingModule',
      ]),
    );
  });
});
