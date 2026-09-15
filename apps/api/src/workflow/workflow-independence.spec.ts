import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Sprint 26's central architectural guarantee, verified executably (docs/domains/
 * workflow.md §2.3/§7 "Domain integration boundary"): the workflow engine itself
 * (everything except `handlers/`) never writes to any domain table directly — only
 * `workflow_*` tables, via its own repositories. Domain mutation happens exclusively
 * through a `WorkflowSubjectHandler` (`handlers/purchase-order-workflow.handler.ts`),
 * which is the one deliberate, documented exception — matching
 * `access-control-independence.spec.ts`'s own precedent for `AccessControlModule`'s
 * read-only `HrModule` import.
 */
describe('Workflow independence (Sprint 26)', () => {
  function readSource(fileName: string): string {
    return readFileSync(join(__dirname, fileName), 'utf-8');
  }

  // Deliberately excludes `workflow.module.ts` — it's the one file allowed to import
  // `PurchaseOrderModule` (the documented domain-integration exception, matching
  // `AccessControlModule`'s own `HrModule` import), checked separately below.
  const ENGINE_FILES = [
    'workflow-audit-actions.ts',
    'workflow-events.ts',
    'workflow-definition.repository.ts',
    'workflow-definition.service.ts',
    'workflow-definition.controller.ts',
    'workflow-instance.repository.ts',
    'workflow-instance.service.ts',
    'workflow-instance.controller.ts',
    'workflow-eligibility.service.ts',
    'workflow-subject-handler.ts',
  ];

  const FORBIDDEN_WRITE_PATTERN =
    /\.(purchaseOrder|purchaseOrderItem|invoice|payment|journalEntry|salesOrder|productionOrder|employee|user|role)\.(create|update|updateMany|delete|deleteMany|upsert|createMany)\(/;

  it('structural guard: no engine file writes to a domain table directly — only `handlers/` may do that', () => {
    for (const fileName of ENGINE_FILES) {
      expect(readSource(fileName)).not.toMatch(FORBIDDEN_WRITE_PATTERN);
    }
  });

  it('structural guard: no engine file imports a Finance/Sales/Production/Distribution/Inventory/Procurement/Suppliers/Assets/Maintenance/HR/Catalogue service, controller, or module — only Identity/Auth is a legitimate cross-domain import for the engine itself', () => {
    for (const fileName of ENGINE_FILES) {
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
      expect(source).not.toMatch(/from ['"].*\bhr\//);
      expect(source).not.toMatch(/from ['"].*\bcatalogue\//);
    }
  });

  it('structural guard: WorkflowModule imports only IdentityModule/AuthModule/PurchaseOrderModule', () => {
    const source = readSource('workflow.module.ts');
    const importsMatch = source.match(/imports:\s*\[([^\]]*)\]/);
    expect(importsMatch).not.toBeNull();
    const importedModules = (importsMatch![1] ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    expect(new Set(importedModules)).toEqual(
      new Set(['IdentityModule', 'AuthModule', 'PurchaseOrderModule']),
    );
  });

  it('structural guard: the Purchase Order handler only writes via PurchaseOrderRepository, never raw Prisma', () => {
    const source = readFileSync(
      join(__dirname, 'handlers', 'purchase-order-workflow.handler.ts'),
      'utf-8',
    );
    expect(source).not.toMatch(/this\.prisma\./);
    expect(source).toMatch(/purchaseOrderRepository/);
  });

  it('structural guard: every eligibility check goes through EffectiveAccessResolver/ScopeEvaluator, never a raw role-name or position/department string comparison', () => {
    for (const fileName of ENGINE_FILES) {
      const source = readSource(fileName);
      expect(source).not.toMatch(/role\.name\s*===/);
      expect(source).not.toMatch(/position\.title\s*===/);
      expect(source).not.toMatch(/department\.name\s*===/);
    }
  });
});
