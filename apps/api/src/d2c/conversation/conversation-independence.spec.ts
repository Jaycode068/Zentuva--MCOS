import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Sprint 33's central architectural guarantee, verified executably rather
 * than just documented (docs/domains/d2c.md §"Channel Neutrality"): the
 * Consumer Conversation layer contains no WhatsApp-specific class or
 * import, no second Consumer/Territory/phone-normalization/notification/
 * authorization/audit system, and never writes to any table outside its
 * own two plus the `Consumer` update calls it makes through the existing,
 * unchanged `ConsumerService`. Mirrors `d2c-independence.spec.ts`'s (Sprint
 * 32) exact structural-guard technique.
 */
describe('D2C Consumer Conversation domain independence (Sprint 33)', () => {
  function readSource(fileName: string): string {
    return readFileSync(join(__dirname, fileName), 'utf-8');
  }

  const CONVERSATION_FILES = [
    'conversation-audit-actions.ts',
    'conversation.types.ts',
    'conversation.repository.ts',
    'conversation-message.repository.ts',
    'conversation.service.ts',
    'conversation.controller.ts',
  ];

  const FORBIDDEN_WRITE_PATTERN =
    /\.(invoice|payment|journalEntry|purchaseOrder|purchaseOrderItem|goodsReceipt|supplier|salesOrder|salesFulfilment|productionOrder|dispatch|delivery|inventoryStock|inventoryTransaction|product|asset|workOrder|maintenanceType|customer|outlet|territory|workflowInstance|workflowStepInstance|workflowDecision|workflowEvent|notification|consumer)\.(create|update|updateMany|delete|deleteMany|upsert|createMany)\(/;

  it('structural guard: no conversation file writes any Consumer/Territory/Customer/Outlet/Finance/Sales/Workflow/Notification table directly — every Consumer mutation goes through the existing ConsumerService', () => {
    for (const fileName of CONVERSATION_FILES) {
      expect(readSource(fileName)).not.toMatch(FORBIDDEN_WRITE_PATTERN);
    }
  });

  it('structural guard: no conversation file imports or defines any WhatsApp-specific class/module — the layer is channel-neutral', () => {
    const FORBIDDEN_CHANNEL_CONSTRUCTS =
      /\b(class|interface)\s+WhatsApp\w*|^import .*WhatsApp\w*.*from/m;
    for (const fileName of CONVERSATION_FILES) {
      expect(readSource(fileName)).not.toMatch(FORBIDDEN_CHANNEL_CONSTRUCTS);
    }
  });

  it('structural guard: no conversation file imports a Finance/Sales/Production/Distribution/Inventory/Procurement/Suppliers/Assets/Maintenance/Catalogue/HR/Workflow/Notifications service, controller, or module', () => {
    for (const fileName of CONVERSATION_FILES) {
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
      expect(source).not.toMatch(/from ['"].*\bnotifications\//);
      expect(source).not.toMatch(
        /NotificationsModule|NotificationEventProcessorService|NotificationService/,
      );
    }
  });

  it('structural guard: no second Consumer/Territory/phone-normalization concept exists — the conversation layer references the EXISTING Sprint 32/4.8 ones only', () => {
    for (const fileName of CONVERSATION_FILES) {
      const source = readSource(fileName);
      expect(source).not.toMatch(/\bnormalizeConversationPhone\b/);
      expect(source).not.toMatch(/class\s+\w*WhatsAppConsumer\w*/);
      expect(source).not.toMatch(/class\s+\w*ConversationConsumer\w*Service\b/);
    }
  });

  it('structural guard: ConversationModule imports only IdentityModule/AuthModule/TerritoryModule/ConsumerModule/D2COrderingModule/D2CPaymentModule/LoyaltyModule (Sprints 34/35/41) — never PromotionModule/RewardModule, so "My Rewards" can only ever READ via LoyaltyService, never evaluate/grant anything itself', () => {
    const source = readFileSync(join(__dirname, 'conversation.module.ts'), 'utf-8');
    expect(source).not.toMatch(/^import .*NotificationsModule.*from/m);
    expect(source).not.toMatch(/^import .*WorkflowModule.*from/m);
    expect(source).not.toMatch(/^import .*\bPromotionModule\b.*from/m);
    expect(source).not.toMatch(/^import .*\bRewardModule\b.*from/m);
    const importsMatch = source.match(/imports:\s*\[([\s\S]*?)\],\s*controllers/);
    expect(importsMatch).not.toBeNull();
    const importedModules = [...(importsMatch![1] ?? '').matchAll(/\b(\w+Module)\b/g)].map(
      (m) => m[1],
    );
    expect(new Set(importedModules)).toEqual(
      new Set([
        'IdentityModule',
        'AuthModule',
        'TerritoryModule',
        'ConsumerModule',
        'D2COrderingModule',
        'D2CPaymentModule',
        'LoyaltyModule',
      ]),
    );
  });

  it('structural guard: ConversationService only mutates Consumer data through ConsumerService method calls, never a repository/Prisma call of its own', () => {
    const source = readSource('conversation.service.ts');
    expect(source).toMatch(
      /this\.consumerService\.(registerConsumer|updateConsumerLocation|reportLocationNotFound|findConsumerByPhone|getById)\(/,
    );
    expect(source).not.toMatch(/this\.prisma\b/);
    expect(source).not.toMatch(/ConsumerRepository/);
  });

  it('structural guard (Sprint 34): ConversationService only ever creates/reads a D2C order through D2COrderingService — never imports SalesOrderRepository/SalesOrderService/Prisma directly (a doc-comment may still legitimately discuss them in prose)', () => {
    const source = readSource('conversation.service.ts');
    expect(source).toMatch(
      /this\.d2cOrderingService\.(confirmOrder|getAvailableProducts|addItemToCart|getCartSummary|removeCartItem)\(/,
    );
    expect(source).not.toMatch(/^import .*from ['"].*\bsales\//m);
    expect(source).not.toMatch(/\bnew SalesOrderService\(|\bnew SalesOrderRepository\(/);
  });
});
