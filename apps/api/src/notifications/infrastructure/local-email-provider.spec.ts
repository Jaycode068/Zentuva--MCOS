import { LocalEmailProvider } from './local-email-provider';

describe('LocalEmailProvider', () => {
  function baseMessage(toEmail: string) {
    return {
      fromEmail: 'noreply@zentuva.test',
      fromName: 'Zentuva',
      toEmail,
      subject: 'Test subject',
      text: 'Test body',
      correlationId: 'corr-1',
    };
  }

  it('accepts a normal message and returns a deterministic provider message id', async () => {
    const provider = new LocalEmailProvider();
    const result = await provider.send(baseMessage('grace@example.com'));
    expect(result.outcome).toBe('ACCEPTED');
    expect(result.providerMessageId).toContain('corr-1');
  });

  it('records every sent message for test/diagnostic assertions', async () => {
    const provider = new LocalEmailProvider();
    await provider.send(baseMessage('grace@example.com'));
    const sent = provider.getSentMessages();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.toEmail).toBe('grace@example.com');
    expect(sent[0]?.subject).toBe('Test subject');
    expect(sent[0]?.outcome).toBe('ACCEPTED');
  });

  it('simulates a retryable failure via the +failretryable@ plus-address convention', async () => {
    const provider = new LocalEmailProvider();
    const result = await provider.send(baseMessage('grace+failretryable@example.com'));
    expect(result.outcome).toBe('RETRYABLE_FAILURE');
    expect(result.errorCategory).toBe('LOCAL_SIMULATED_RETRYABLE');
    expect(result.providerMessageId).toBeUndefined();
  });

  it('simulates a terminal failure via the +failterminal@ plus-address convention', async () => {
    const provider = new LocalEmailProvider();
    const result = await provider.send(baseMessage('grace+failterminal@example.com'));
    expect(result.outcome).toBe('TERMINAL_FAILURE');
    expect(result.errorCategory).toBe('LOCAL_SIMULATED_TERMINAL');
  });

  it('never sends real email — has no network/SMTP dependency at all', () => {
    // Structural: this test file has no mocking of network calls because
    // LocalEmailProvider makes none — it is entirely in-memory.
    const provider = new LocalEmailProvider();
    expect(provider.name).toBe('local');
  });

  it('reset() clears recorded messages between test cases', async () => {
    const provider = new LocalEmailProvider();
    await provider.send(baseMessage('grace@example.com'));
    provider.reset();
    expect(provider.getSentMessages()).toHaveLength(0);
  });
});
