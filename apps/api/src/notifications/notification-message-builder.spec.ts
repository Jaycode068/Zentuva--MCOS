import { NotificationMessageBuilder } from './notification-message-builder';
import { WorkflowSubjectHandler } from '../workflow/workflow-subject-handler';

describe('NotificationMessageBuilder', () => {
  const instance = {
    id: 'instance-1',
    organisationId: 'org-1',
    subjectType: 'PURCHASE_ORDER',
    subjectId: 'po-1',
  } as never;

  const step = { stepNameSnapshot: 'Procurement Review' } as never;

  function makeBuilder(describeResult: string | null = 'PO-000012') {
    const handler = {
      subjectType: 'PURCHASE_ORDER',
      describe: jest.fn().mockResolvedValue(describeResult),
    } as unknown as jest.Mocked<WorkflowSubjectHandler>;
    return new NotificationMessageBuilder([handler]);
  }

  it('builds an approval-required message including the step name and a humanized subject label', async () => {
    const builder = makeBuilder();
    const event = { eventType: 'APPROVAL_REQUIRED', summary: {} } as never;
    const result = await builder.build(event, instance, step);
    expect(result).toMatchObject({
      type: 'WORKFLOW_APPROVAL_REQUIRED',
      title: 'Approval required',
    });
    expect(result?.body).toContain('Purchase Order PO-000012');
    expect(result?.body).toContain('Procurement Review');
    expect(result?.actionUrl).toBe('/settings/workflows/instances/instance-1');
  });

  it('falls back to a short id-derived reference when describe() returns null', async () => {
    const builder = makeBuilder(null);
    const event = { eventType: 'APPROVED', summary: {} } as never;
    const result = await builder.build(event, instance, undefined);
    expect(result?.body).toContain('#');
    expect(result?.body).not.toContain('null');
  });

  it('includes the comment from event.summary for REJECTED/RETURNED when present', async () => {
    const builder = makeBuilder();
    const event = { eventType: 'REJECTED', summary: { comment: 'Wrong supplier' } } as never;
    const result = await builder.build(event, instance, undefined);
    expect(result?.body).toContain('Wrong supplier');
  });

  it('handles a missing comment safely (no "undefined" leaking into the message)', async () => {
    const builder = makeBuilder();
    const event = { eventType: 'RETURNED', summary: {} } as never;
    const result = await builder.build(event, instance, undefined);
    expect(result?.body).not.toContain('undefined');
    expect(result?.body.endsWith('.')).toBe(true);
  });

  it('handles a missing step name safely for STEP_APPROVED', async () => {
    const builder = makeBuilder();
    const event = { eventType: 'STEP_APPROVED', summary: {} } as never;
    const result = await builder.build(event, instance, undefined);
    expect(result?.body).not.toContain('undefined');
  });

  it('returns null for an event type with no defined message', async () => {
    const builder = makeBuilder();
    const event = { eventType: 'SUBMITTED', summary: {} } as never;
    await expect(builder.build(event, instance, undefined)).resolves.toBeNull();
  });

  it('produces plain text only — no HTML tags, even when the comment contains angle brackets', async () => {
    const builder = makeBuilder();
    const event = {
      eventType: 'REJECTED',
      summary: { comment: '<script>alert(1)</script>' },
    } as never;
    const result = await builder.build(event, instance, undefined);
    // The builder itself must not strip/encode (that's the frontend's job as plain
    // text), but it must also never wrap it in real HTML markup of its own.
    expect(result?.body).toContain('<script>alert(1)</script>');
    expect(result?.title).not.toMatch(/<[^>]+>/);
  });

  it('is deterministic: the same event/instance/step produces the same message twice', async () => {
    const builder = makeBuilder();
    const event = { eventType: 'APPROVED', summary: {} } as never;
    const first = await builder.build(event, instance, undefined);
    const second = await builder.build(event, instance, undefined);
    expect(first).toEqual(second);
  });
});
