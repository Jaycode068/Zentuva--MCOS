import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Sprint 34's central architectural guarantee, verified executably rather than just
 * documented (docs/domains/d2c.md "D2C Ordering Architecture"): `D2COrderingService`
 * reuses the EXISTING Product Catalogue and Sales Order domains rather than duplicating
 * either, never creates a `SalesOrder`/`SalesOrderItem` itself (it always delegates to
 * `SalesOrderService`), never persists a cart of its own, and contains no WhatsApp-
 * specific or workflow-engine code. Unlike `d2c-independence.spec.ts`/
 * `conversation-independence.spec.ts` (which forbid importing Sales/Catalogue
 * entirely), this domain's whole job IS to sit between the Conversation Layer and
 * those two — so its guards instead assert it imports ONLY what that role requires,
 * and never mutates either domain's tables directly.
 */
describe('D2C Ordering domain independence (Sprint 34)', () => {
  function readSource(fileName: string): string {
    return readFileSync(join(__dirname, fileName), 'utf-8');
  }

  const ORDERING_FILES = ['d2c-ordering.types.ts', 'd2c-ordering.service.ts'];

  it('structural guard: D2COrderingService never writes to Product/SalesOrder/SalesOrderItem/Consumer tables directly — every mutation goes through ProductRepository (read-only)/SalesOrderService/ConsumerService', () => {
    const source = readSource('d2c-ordering.service.ts');
    expect(source).not.toMatch(
      /this\.(prisma)\.(product|salesOrder|salesOrderItem|consumer)\.(create|update|updateMany|delete|deleteMany|upsert|createMany)\(/,
    );
    expect(source).not.toMatch(/SalesOrderRepository|ConsumerRepository/);
    expect(source).toMatch(/this\.salesOrderService\.createForConsumer\(/);
  });

  it('structural guard: no ordering file imports or defines any WhatsApp-specific class/module — the layer is channel-neutral', () => {
    const FORBIDDEN_CHANNEL_CONSTRUCTS =
      /\b(class|interface)\s+WhatsApp\w*|^import .*WhatsApp\w*.*from/m;
    for (const fileName of ORDERING_FILES) {
      expect(readSource(fileName)).not.toMatch(FORBIDDEN_CHANNEL_CONSTRUCTS);
    }
  });

  it('structural guard: no ordering file imports Finance/Production/Distribution/Inventory/Procurement/Suppliers/Assets/Maintenance/HR/Workflow/Notifications — its only cross-domain dependencies are Catalogue (Product), Sales (SalesOrder), and D2C Consumer', () => {
    for (const fileName of ORDERING_FILES) {
      const source = readSource(fileName);
      expect(source).not.toMatch(/from ['"].*\bfinance\//);
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

  it('structural guard: no persistent cart infrastructure exists — CartLine is a plain in-memory type, never a Prisma model or repository', () => {
    const typesSource = readSource('d2c-ordering.types.ts');
    expect(typesSource).not.toMatch(/@prisma\/client/);
    const serviceSource = readSource('d2c-ordering.service.ts');
    expect(serviceSource).not.toMatch(/CartRepository|cart\.(create|update|findMany|findUnique)\(/);
  });

  it('structural guard: D2COrderingModule imports only ProductModule/SalesModule/ConsumerModule/IdentityModule/CollectionPointFulfillmentModule, no controller', () => {
    const source = readFileSync(join(__dirname, 'd2c-ordering.module.ts'), 'utf-8');
    expect(source).not.toMatch(/controllers:/);
    const importsMatch = source.match(/imports:\s*\[([\s\S]*?)\],\s*providers/);
    expect(importsMatch).not.toBeNull();
    const importedModules = [...(importsMatch![1] ?? '').matchAll(/\b(\w+Module)\b/g)].map(
      (m) => m[1],
    );
    // CollectionPointFulfillmentModule added Sprint 42 — read-only fulfilment status for
    // "My Orders" (see the top-of-file doc comment).
    expect(new Set(importedModules)).toEqual(
      new Set([
        'ProductModule',
        'SalesModule',
        'ConsumerModule',
        'IdentityModule',
        'CollectionPointFulfillmentModule',
      ]),
    );
  });
});
