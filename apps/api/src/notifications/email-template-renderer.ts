import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Notification } from '@prisma/client';

import { escapeHtml } from './html-escape.util';

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

/**
 * Sprint 28 §Workstream C "Email Templates and Rendering" (docs/architecture/
 * email-delivery.md "Notification intent versus delivery attempt"). Deliberately
 * has NO per-category template catalogue of its own — `Notification.title`/`body`/
 * `actionUrl` (already built, once, by `NotificationMessageBuilder`, Sprint 27) ARE
 * the approved, already-safe variables this renders. Re-deriving subject/body text
 * a second time here would be a second, parallel "what does this event mean in
 * words" implementation — exactly the duplication Sprint 28's own brief warns
 * against ("do not create duplicate infrastructure").
 *
 * `templateKey` (stored on `EmailDelivery`) is simply `notification.type` — the
 * `NotificationType` enum already IS the stable per-category key the brief asks
 * for; no second enum/catalogue was introduced.
 */
@Injectable()
export class EmailTemplateRenderer {
  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  render(notification: Notification, organisationName: string): RenderedEmail {
    const webPublicUrl = this.config.get<string>('email.webPublicUrl') ?? 'http://localhost:3000';
    const absoluteActionUrl = notification.actionUrl
      ? `${webPublicUrl}${notification.actionUrl}`
      : webPublicUrl;

    const subject = notification.title;
    const text = [
      notification.body,
      '',
      `Open in Zentuva: ${absoluteActionUrl}`,
      '',
      `— ${organisationName}, via Zentuva`,
      'You can manage which of these emails you receive in your Zentuva notification preferences.',
    ].join('\n');

    const html = [
      `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;color:#1a1a1a;">`,
      `<p style="font-size:16px;line-height:1.5;">${escapeHtml(notification.body)}</p>`,
      `<p style="margin:24px 0;"><a href="${escapeHtml(absoluteActionUrl)}" style="display:inline-block;padding:10px 20px;background:#7C3AED;color:#ffffff;text-decoration:none;border-radius:6px;font-size:14px;">Open in Zentuva</a></p>`,
      `<hr style="border:none;border-top:1px solid #e5e5e5;margin:24px 0;" />`,
      `<p style="font-size:12px;color:#6b6b6b;line-height:1.5;">Sent by ${escapeHtml(organisationName)}, via Zentuva. You can manage which of these emails you receive in your Zentuva notification preferences.</p>`,
      `</div>`,
    ].join('');

    return { subject, text, html };
  }
}
