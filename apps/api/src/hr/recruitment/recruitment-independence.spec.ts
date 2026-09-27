import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Sprint 30's central architectural guarantee, verified executably rather
 * than just documented (docs/domains/recruitment.md "Workflow Integration" /
 * "Notification Integration"): Recruitment never turns Candidate/Application/
 * Interview into a `WorkflowInstance` (only `HiringRequest`, exclusively via
 * `HiringRequestWorkflowHandler` in `workflow/handlers/`, outside this
 * module), never imports `NotificationsModule` (writes `Notification` rows
 * directly via the globally-registered `PrismaService`, avoiding the
 * circular module dependency documented on `RecruitmentModule` itself), and
 * never mutates any Finance/Sales/Production/Distribution/Inventory/
 * Procurement/Suppliers/Assets/Maintenance/Catalogue table. Mirrors
 * `hr-independence.spec.ts`'s exact structural-guard technique.
 */
describe('Recruitment & Candidate Interview Management Foundation independence (Sprint 30)', () => {
  function readSource(fileName: string): string {
    return readFileSync(join(__dirname, fileName), 'utf-8');
  }

  const RECRUITMENT_FILES = [
    'recruitment-audit-actions.ts',
    'candidate.repository.ts',
    'hiring-request.repository.ts',
    'hiring-request.service.ts',
    'hiring-request.controller.ts',
    'vacancy.repository.ts',
    'vacancy.service.ts',
    'vacancy.controller.ts',
    'application.repository.ts',
    'application.service.ts',
    'application.controller.ts',
    'interview-stage.repository.ts',
    'interview-stage.service.ts',
    'interview.repository.ts',
    'interview.service.ts',
    'interview.controller.ts',
    'interview-evaluation.repository.ts',
    'interview-evaluation.service.ts',
    'interview-evaluation.controller.ts',
    'interview-stage-decision.repository.ts',
    'interview-stage-decision.service.ts',
    'offer.repository.ts',
    'offer.service.ts',
    'offer.controller.ts',
    'recruitment-notification.service.ts',
    'public/careers.service.ts',
    'public/careers.controller.ts',
  ];

  const FORBIDDEN_WRITE_PATTERN =
    /\.(invoice|payment|journalEntry|purchaseOrder|purchaseOrderItem|goodsReceipt|supplier|salesOrder|salesFulfilment|productionOrder|dispatch|delivery|inventoryStock|inventoryTransaction|product|asset|workOrder|maintenanceType|workflowInstance|workflowStepInstance|workflowDecision|workflowEvent)\.(create|update|updateMany|delete|deleteMany|upsert|createMany)\(/;

  it('structural guard: no recruitment file writes any Finance/Procurement/Sales/Production/Distribution/Inventory/Asset/Maintenance/Workflow table', () => {
    for (const fileName of RECRUITMENT_FILES) {
      expect(readSource(fileName)).not.toMatch(FORBIDDEN_WRITE_PATTERN);
    }
  });

  it('structural guard: only recruitment-notification.service.ts ever writes to the notifications table', () => {
    for (const fileName of RECRUITMENT_FILES) {
      if (fileName === 'recruitment-notification.service.ts') continue;
      expect(readSource(fileName)).not.toMatch(
        /\.notification\.(create|createMany|update|updateMany)\(/,
      );
    }
    expect(readSource('recruitment-notification.service.ts')).toMatch(
      /\.notification\.createMany\(/,
    );
  });

  it('structural guard: no recruitment file imports WorkflowInstanceService/WorkflowDefinitionService/NotificationsModule — only the generic Workflow HTTP endpoints are used, from the frontend, never a direct service import', () => {
    // Checks actual `import ... from` statements only — not prose. Several
    // files' own doc comments legitimately DISCUSS these names to explain
    // why they are deliberately absent (e.g. `recruitment-notification.
    // service.ts`'s own explanation of why it does NOT import
    // `NotificationsModule`).
    for (const fileName of RECRUITMENT_FILES) {
      const source = readSource(fileName);
      expect(source).not.toMatch(/^import .*WorkflowInstanceService.*from/m);
      expect(source).not.toMatch(/^import .*WorkflowDefinitionService.*from/m);
      expect(source).not.toMatch(/^import .*NotificationsModule.*from/m);
      expect(source).not.toMatch(/^import .*NotificationEventProcessorService.*from/m);
    }
  });

  it('structural guard: no recruitment file imports a Finance/Sales/Production/Distribution/Inventory/Procurement/Suppliers/Assets/Maintenance/Catalogue service, controller, or module', () => {
    for (const fileName of RECRUITMENT_FILES) {
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
    }
  });

  it('structural guard: RecruitmentModule imports only IdentityModule/AuthModule/HrModule/FileStorageModule/ThrottlerModule', () => {
    const source = readFileSync(join(__dirname, 'recruitment.module.ts'), 'utf-8');
    // Checks actual `import { X } from '...module'` statements — not prose,
    // since this file's own doc comment legitimately DISCUSSES
    // NotificationsModule/WorkflowModule by name to explain why they are
    // deliberately absent from the imports array below.
    expect(source).not.toMatch(/^import .*NotificationsModule.*from/m);
    expect(source).not.toMatch(/^import .*WorkflowModule.*from/m);
    const importsMatch = source.match(/imports:\s*\[([\s\S]*?)\],\s*controllers/);
    expect(importsMatch).not.toBeNull();
    // Extract every `XModule` token rather than splitting on commas — the
    // `ThrottlerModule.forRoot([{ ttl, limit }])` call itself contains
    // commas, which would otherwise fragment a naive comma-split.
    const importedModules = [...(importsMatch![1] ?? '').matchAll(/\b(\w+Module)\b/g)].map(
      (m) => m[1],
    );
    expect(new Set(importedModules)).toEqual(
      new Set(['IdentityModule', 'AuthModule', 'HrModule', 'FileStorageModule', 'ThrottlerModule']),
    );
  });
});
