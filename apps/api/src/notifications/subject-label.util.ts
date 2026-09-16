import { WorkflowSubjectHandler } from '../workflow/workflow-subject-handler';

/** `PURCHASE_ORDER` → `Purchase Order` — generic, not a per-domain lookup table, so a
 *  future subject type needs no change here. Shared by `NotificationMessageBuilder`
 *  and `ActivityService` so the two surfaces never drift on how a subject reads. */
export function humanizeSubjectType(subjectType: string): string {
  return subjectType
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export async function describeSubject(
  handlersByType: Map<string, WorkflowSubjectHandler>,
  organisationId: string,
  subjectType: string,
  subjectId: string,
): Promise<string> {
  const handler = handlersByType.get(subjectType);
  const reference = handler ? await handler.describe(organisationId, subjectId) : null;
  return reference ?? `#${subjectId.slice(-8)}`;
}
