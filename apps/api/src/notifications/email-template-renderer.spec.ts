import { ConfigService } from '@nestjs/config';
import { Notification } from '@prisma/client';

import { EmailTemplateRenderer } from './email-template-renderer';

describe('EmailTemplateRenderer', () => {
  function makeNotification(overrides: Partial<Notification> = {}): Notification {
    return {
      id: 'notif-1',
      organisationId: 'org-1',
      recipientUserId: 'user-1',
      type: 'WORKFLOW_APPROVAL_REQUIRED',
      channel: 'IN_APP',
      title: 'Approval required',
      body: 'Purchase Order PO-000123 is awaiting your approval (Final Approval).',
      status: 'UNREAD',
      readAt: null,
      sourceEventId: 'event-1',
      sourceType: 'PURCHASE_ORDER',
      sourceId: 'po-1',
      actionUrl: '/settings/workflows/instances/instance-1',
      metadata: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    } as Notification;
  }

  function makeRenderer(webPublicUrl = 'http://localhost:3000') {
    const config = { get: jest.fn().mockReturnValue(webPublicUrl) } as unknown as ConfigService;
    return new EmailTemplateRenderer(config);
  }

  it('uses the notification title as the subject verbatim', () => {
    const renderer = makeRenderer();
    const rendered = renderer.render(makeNotification(), 'Boby Bites');
    expect(rendered.subject).toBe('Approval required');
  });

  it('produces a plain-text body containing the notification body and an absolute action URL', () => {
    const renderer = makeRenderer('http://localhost:3000');
    const rendered = renderer.render(makeNotification(), 'Boby Bites');
    expect(rendered.text).toContain('Purchase Order PO-000123 is awaiting your approval');
    expect(rendered.text).toContain(
      'http://localhost:3000/settings/workflows/instances/instance-1',
    );
    expect(rendered.text).toContain('Boby Bites');
  });

  it('produces an HTML body with an absolute link and the organisation name', () => {
    const renderer = makeRenderer('http://localhost:3000');
    const rendered = renderer.render(makeNotification(), 'Boby Bites');
    expect(rendered.html).toContain(
      'http://localhost:3000/settings/workflows/instances/instance-1',
    );
    expect(rendered.html).toContain('Boby Bites');
  });

  it('HTML-escapes a user-authored comment embedded in the notification body', () => {
    const renderer = makeRenderer();
    const malicious = makeNotification({
      body: 'Your Purchase Order was rejected: "<script>alert(1)</script>"',
    });
    const rendered = renderer.render(malicious, 'Boby Bites');
    expect(rendered.html).not.toContain('<script>alert(1)</script>');
    expect(rendered.html).toContain('&lt;script&gt;');
    // The plain-text variant is safe to leave unescaped — it is never rendered as HTML.
    expect(rendered.text).toContain('<script>alert(1)</script>');
  });

  it('falls back to a bare webPublicUrl link when actionUrl is absent', () => {
    const renderer = makeRenderer('http://localhost:3000');
    const rendered = renderer.render(makeNotification({ actionUrl: null }), 'Boby Bites');
    expect(rendered.text).toContain('http://localhost:3000');
  });

  it('escapes special characters in the organisation name for the HTML footer', () => {
    const renderer = makeRenderer();
    const rendered = renderer.render(makeNotification(), 'A & B <Co>');
    expect(rendered.html).toContain('A &amp; B &lt;Co&gt;');
  });
});
