import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Sprint 40.5's central architectural guarantee, verified executably (brief "Do NOT
 * build another chatbot"): `WhatsAppInboundAdapterService` is a thin translator over
 * the EXISTING `ConversationService` — never a second conversational state machine,
 * never a direct write to Consumer/SalesOrder/Payment tables. Mirrors
 * `conversation-independence.spec.ts`'s exact structural-guard technique.
 */
describe('D2C WhatsApp domain independence (Sprint 40.5)', () => {
  function readSource(fileName: string): string {
    return readFileSync(join(__dirname, fileName), 'utf-8');
  }

  const WHATSAPP_FILES = [
    'whatsapp-audit-actions.ts',
    'whatsapp.types.ts',
    'whatsapp-webhook-event.repository.ts',
    'whatsapp-organisation-resolver.service.ts',
    'whatsapp-inbound-adapter.service.ts',
    'whatsapp-webhook.controller.ts',
    'whatsapp-test.controller.ts',
  ];

  it('structural guard: no WhatsApp file writes any Consumer/SalesOrder/Payment/ConsumerConversation table directly — the layer only ever calls the existing ConversationService/ConsumerRepository (read-only cross-tenant lookup) methods', () => {
    const FORBIDDEN_WRITE_PATTERN =
      /\.(consumer|salesOrder|payment|consumerConversation|consumerConversationMessage)\.(create|update|updateMany|delete|deleteMany|upsert|createMany)\(/;
    for (const fileName of WHATSAPP_FILES) {
      expect(readSource(fileName)).not.toMatch(FORBIDDEN_WRITE_PATTERN);
    }
  });

  it('structural guard: the inbound adapter drives inbound messages exclusively through ConversationService.handleInboundMessage — never a second state machine', () => {
    const source = readSource('whatsapp-inbound-adapter.service.ts');
    expect(source).toMatch(/this\.conversationService\.handleInboundMessage\(/);
    expect(source).not.toMatch(/class\s+\w*Conversation\w*Service\b/);
    expect(source).not.toMatch(/\bswitch\s*\(\s*conversation\.state\s*\)/);
  });

  it('structural guard: no WhatsApp file imports a Finance/Sales/Production/Distribution/Inventory/Procurement/Suppliers/Assets/Maintenance/Catalogue/HR/Workflow service, controller, or module', () => {
    for (const fileName of WHATSAPP_FILES) {
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
    }
  });

  it('structural guard: the webhook/test controllers never log or return the access/verify token, and never contact graph.facebook.com directly (that stays inside MetaWhatsAppProvider only)', () => {
    for (const fileName of ['whatsapp-webhook.controller.ts', 'whatsapp-test.controller.ts']) {
      const source = readSource(fileName);
      expect(source).not.toMatch(/graph\.facebook\.com/);
      expect(source).not.toMatch(/Authorization.*Bearer/);
    }
  });
});
