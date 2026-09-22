import { ConfigService } from '@nestjs/config';
import { Notification, NotificationType } from '@prisma/client';

/**
 * Sprint 29 §9 "WhatsApp Template Model." WhatsApp business-initiated
 * transactional messages must use a pre-approved template — never arbitrary
 * free-form text (brief §9 "Do not build arbitrary free-form outbound
 * messages as the primary mechanism"). This is the ONE place a
 * `NotificationType` resolves to a template; nothing else in this codebase
 * constructs a template name, and no caller may pass one in directly (brief
 * §9 "Do not allow arbitrary user-provided template names to be passed
 * directly from normal business-domain code").
 *
 * Deliberately narrow this sprint: only `WORKFLOW_APPROVAL_REQUIRED` has a
 * template (brief §15 "start with APPROVAL_REQUIRED... only add other
 * categories if they naturally fit and can be tested completely"). Every
 * other `NotificationType` has no template — `resolveTemplate` returns
 * `null`, which `WhatsAppEligibilityService` treats as "not WhatsApp-
 * eligible," exactly like `EmailEligibilityService`'s own category scoping
 * (Sprint 28).
 */
export interface ResolvedWhatsAppTemplate {
  name: string;
  language: string;
  parameters: Record<string, string>;
}

/** The FIXED positional order the `zentuva_approval_required` template's body
 *  placeholders (`{{1}}`, `{{2}}`, `{{3}}`, `{{4}}`) are assumed to expect —
 *  used only by `MetaWhatsAppProvider` when constructing the real API
 *  request; `templateParameterSnapshot` itself stays a named, human-readable
 *  record regardless (brief §10's own worked example is a named JSON object,
 *  not a positional array). **This exact order is an assumption, not a
 *  verified fact** — brief §9 explicitly requires verifying the real
 *  approved template's actual placeholder order/definition in the WhatsApp
 *  Business account before a real send; no real account was available this
 *  sprint to confirm against (see docs/architecture/whatsapp-delivery.md
 *  "Template placeholder order — an open item"). */
export const APPROVAL_TEMPLATE_PARAMETER_ORDER = [
  'recipientName',
  'documentType',
  'documentNumber',
  'approvalUrl',
] as const;

/** Deliberately does NOT include a monetary "amount" parameter, even though
 *  the brief's own example message shows one — no `Notification`/
 *  `WorkflowEvent` field carries a business amount, and adding one would
 *  require a new cross-domain READ into Procurement, which is out of this
 *  sprint's scope and unnecessary to prove the pipeline. Uses exactly the
 *  same `describeSubject`/`humanizeSubjectType` utilities `EmailTemplateRenderer`/
 *  `NotificationMessageBuilder` already use for the human-readable subject
 *  reference — no new cross-domain coupling introduced. */
export function resolveWhatsAppTemplate(
  config: ConfigService,
  notification: Notification,
  recipientName: string,
  subjectReference: string,
  subjectLabel: string,
  approvalUrl: string,
): ResolvedWhatsAppTemplate | null {
  const type: NotificationType = notification.type;
  if (type !== 'WORKFLOW_APPROVAL_REQUIRED') {
    return null;
  }

  return {
    name: config.get<string>('whatsapp.approvalTemplateName') ?? 'zentuva_approval_required',
    language: config.get<string>('whatsapp.approvalTemplateLanguage') ?? 'en_US',
    parameters: {
      recipientName,
      documentType: subjectLabel,
      documentNumber: subjectReference,
      approvalUrl,
    },
  };
}
