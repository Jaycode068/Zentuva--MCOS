import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Sprint 27's central architectural guarantee, verified executably (docs/domains/
 * notifications.md §4 "Event-consumption architecture"): Notifications consumes
 * Workflow through a DATA boundary (`WorkflowEvent`/`WorkflowInstance`/
 * `WorkflowStepInstance` read via Prisma) rather than a SERVICE boundary
 * (`WorkflowInstanceService`), and can never mutate workflow state — only its own
 * `notifications` table plus the processing-state columns Sprint 26.1/27 added
 * directly to `workflow_events`. The dependency is one-directional: Notifications
 * imports `WorkflowModule` (read-only, for `WorkflowEligibilityService`/
 * `WorkflowDefinitionService`/`WORKFLOW_SUBJECT_HANDLERS`); `WorkflowModule` has zero
 * awareness of Notifications, matching `workflow-independence.spec.ts`'s own
 * precedent for the Workflow → PurchaseOrder boundary.
 */
describe('Notifications independence (Sprint 27)', () => {
  function readSource(dir: string, fileName: string): string {
    return readFileSync(join(dir, fileName), 'utf-8');
  }

  const notificationsDir = __dirname;
  const workflowDir = join(__dirname, '..', 'workflow');

  const NOTIFICATION_FILES = [
    'notification-recipient-resolver.ts',
    'notification-message-builder.ts',
    'notification-event-processor.service.ts',
    'notification.repository.ts',
    'notification.service.ts',
    'notifications.controller.ts',
    'activity.service.ts',
    'subject-label.util.ts',
  ];

  it('structural guard: no Notifications file IMPORTS WorkflowInstanceService — the boundary is the WorkflowEvent/WorkflowInstance/WorkflowStepInstance TABLES, never a call into the engine itself (doc comments explaining this are fine; an actual import is not)', () => {
    for (const fileName of NOTIFICATION_FILES) {
      const source = readSource(notificationsDir, fileName);
      const importLines = source
        .split('\n')
        .filter((line) => /^\s*import\b/.test(line))
        .join('\n');
      expect(importLines).not.toMatch(/WorkflowInstanceService/);
      expect(importLines).not.toMatch(/WorkflowDefinitionRepository/);
      expect(importLines).not.toMatch(/WorkflowInstanceRepository/);
    }
  });

  it('structural guard: no Notifications file writes to a Workflow table other than the notification-processing columns on WorkflowEvent — it cannot mutate workflow state', () => {
    const FORBIDDEN_WRITE_PATTERN =
      /\.(workflowInstance|workflowStep|workflowStepInstance|workflowDefinition|workflowDecision)\.(create|update|updateMany|delete|deleteMany|upsert|createMany)\(/;
    for (const fileName of NOTIFICATION_FILES) {
      expect(readSource(notificationsDir, fileName)).not.toMatch(FORBIDDEN_WRITE_PATTERN);
    }
    // The one permitted write: WorkflowEvent's own processing-state columns, and
    // only from the processor.
    const processorSource = readSource(notificationsDir, 'notification-event-processor.service.ts');
    expect(processorSource).toMatch(/workflowEvent\.update\(/);
  });

  it('structural guard: NotificationsModule imports only IdentityModule/AuthModule/WorkflowModule', () => {
    const source = readSource(notificationsDir, 'notifications.module.ts');
    const importsMatch = source.match(/imports:\s*\[([^\]]*)\]/);
    expect(importsMatch).not.toBeNull();
    const importedModules = (importsMatch![1] ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    expect(new Set(importedModules)).toEqual(
      new Set(['IdentityModule', 'AuthModule', 'WorkflowModule']),
    );
  });

  it('structural guard: WorkflowModule (the producer) never IMPORTS NotificationsModule — the dependency is strictly one-directional (a doc comment referencing "Notifications" to explain the boundary is fine; an actual import is not)', () => {
    const source = readSource(workflowDir, 'workflow.module.ts');
    const importLines = source
      .split('\n')
      .filter((line) => /^\s*import\b/.test(line))
      .join('\n');
    expect(importLines).not.toMatch(/Notification/);
    expect(source).not.toMatch(/imports:\s*\[[^\]]*Notification/);
  });

  it('structural guard: no Notification-facing file compares a raw role/position/department name — eligibility is always delegated to WorkflowEligibilityService', () => {
    for (const fileName of NOTIFICATION_FILES) {
      const source = readSource(notificationsDir, fileName);
      expect(source).not.toMatch(/role\.name\s*===/);
      expect(source).not.toMatch(/position\.title\s*===/);
      expect(source).not.toMatch(/department\.name\s*===/);
    }
  });
});
