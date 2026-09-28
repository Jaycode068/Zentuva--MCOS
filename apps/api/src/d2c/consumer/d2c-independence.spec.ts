import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Sprint 32's central architectural guarantee, verified executably rather
 * than just documented (docs/domains/d2c.md §2 "Channel Neutrality"): the
 * Consumer domain is channel-neutral — it contains no WhatsApp-specific
 * class, no WhatsApp import, and no reference to any future
 * conversation/messaging concept. It also never mutates any B2B/other-
 * domain table directly, and never introduces a second Territory/geography
 * model. Mirrors `recruitment-independence.spec.ts`'s exact structural-guard
 * technique.
 */
describe('D2C Consumer domain independence (Sprint 32)', () => {
  function readSource(fileName: string): string {
    return readFileSync(join(__dirname, fileName), 'utf-8');
  }

  const D2C_FILES = [
    'consumer-audit-actions.ts',
    'consumer.repository.ts',
    'consumer-location-request.repository.ts',
    'consumer.service.ts',
    'consumer.controller.ts',
  ];

  const FORBIDDEN_WRITE_PATTERN =
    /\.(invoice|payment|journalEntry|purchaseOrder|purchaseOrderItem|goodsReceipt|supplier|salesOrder|salesFulfilment|productionOrder|dispatch|delivery|inventoryStock|inventoryTransaction|product|asset|workOrder|maintenanceType|customer|outlet|territory|workflowInstance|workflowStepInstance|workflowDecision|workflowEvent|notification)\.(create|update|updateMany|delete|deleteMany|upsert|createMany)\(/;

  it('structural guard: no D2C file writes any Territory/Customer/Outlet/Finance/Sales/Production/Workflow/Notification table directly', () => {
    for (const fileName of D2C_FILES) {
      expect(readSource(fileName)).not.toMatch(FORBIDDEN_WRITE_PATTERN);
    }
  });

  it('structural guard: no D2C file imports or defines any WhatsApp-specific class/module — the domain is channel-neutral (prose may legitimately DISCUSS WhatsApp to explain why it is absent, so this checks actual code constructs, not text)', () => {
    const FORBIDDEN_CHANNEL_CONSTRUCTS =
      /\b(class|interface)\s+WhatsApp\w*|^import .*WhatsApp\w*.*from|@Injectable\(\)\s*\n\s*export class \w*(WhatsApp|Meta|Webhook)\w*/m;
    for (const fileName of D2C_FILES) {
      expect(readSource(fileName)).not.toMatch(FORBIDDEN_CHANNEL_CONSTRUCTS);
    }
  });

  it('structural guard: no D2C file imports a Finance/Sales/Production/Distribution/Inventory/Procurement/Suppliers/Assets/Maintenance/Catalogue/HR/Workflow service, controller, or module — and the ONE permitted `notifications/` import is the shared phone-number-normalizer utility, never a notification service/module', () => {
    for (const fileName of D2C_FILES) {
      const source = readSource(fileName);
      expect(source).not.toMatch(/from ['"].*\bfinance\//);
      expect(source).not.toMatch(/from ['"].*\bsales\//);
      expect(source).not.toMatch(/from ['"].*\bproduction\//);
      expect(source).not.toMatch(/from ['"].*\bdistribution\//);
      expect(source).not.toMatch(/from ['"].*\binventory\//);
      expect(source).not.toMatch(/from ['"].*\bprocurement\//);
      expect(source).not.toMatch(/from ['"].*\bsuppliers\//);
      expect(source).not.toMatch(/from ['"].*\bassets\//);
      expect(source).not.toMatch(/from ['"].*\bmaintenance\//);
      expect(source).not.toMatch(/from ['"].*\bcatalogue\//);
      expect(source).not.toMatch(/from ['"].*\bhr\//);
      expect(source).not.toMatch(/from ['"].*\bworkflow\//);
      // Any `notifications/` import must be exactly the phone normalizer.
      const notificationsImports = [...source.matchAll(/from ['"](.*notifications\/[^'"]+)['"]/g)];
      for (const match of notificationsImports) {
        expect(match[1]).toMatch(/phone-number-normalizer$/);
      }
      expect(source).not.toMatch(
        /NotificationsModule|NotificationEventProcessorService|NotificationService/,
      );
    }
  });

  it('structural guard: only retail/territory is imported for structured location — no second Location/geography model exists in this domain', () => {
    for (const fileName of D2C_FILES) {
      const source = readSource(fileName);
      expect(source).not.toMatch(/\bConsumerTerritory\b/);
      expect(source).not.toMatch(/\bD2CTerritory\b/);
      expect(source).not.toMatch(/\bWhatsAppTerritory\b/);
      expect(source).not.toMatch(/\bConsumerRegion\b/);
      expect(source).not.toMatch(/\bConsumerLocation\b(?!Request)/);
    }
  });

  it('structural guard: ConsumerModule imports only IdentityModule/AuthModule/TerritoryModule', () => {
    const source = readFileSync(join(__dirname, 'consumer.module.ts'), 'utf-8');
    expect(source).not.toMatch(/^import .*NotificationsModule.*from/m);
    expect(source).not.toMatch(/^import .*WorkflowModule.*from/m);
    const importsMatch = source.match(/imports:\s*\[([\s\S]*?)\],\s*controllers/);
    expect(importsMatch).not.toBeNull();
    const importedModules = [...(importsMatch![1] ?? '').matchAll(/\b(\w+Module)\b/g)].map(
      (m) => m[1],
    );
    expect(new Set(importedModules)).toEqual(
      new Set(['IdentityModule', 'AuthModule', 'TerritoryModule']),
    );
  });

  it('structural guard: ConsumerService reuses the existing phone-number-normalizer rather than a second implementation', () => {
    const source = readSource('consumer.service.ts');
    expect(source).toMatch(/from ['"].*notifications\/phone-number-normalizer['"]/);
    expect(source).not.toMatch(/function\s+normalizePhoneNumber/);
  });
});
