import { ConfigService } from '@nestjs/config';

const sendMail = jest.fn();
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({ sendMail })),
}));

import { loadSmtpConfig, SmtpConfigurationError, SmtpEmailProvider } from './smtp-email-provider';

describe('SmtpEmailProvider', () => {
  function makeConfig(overrides: Record<string, unknown> = {}) {
    const values: Record<string, unknown> = {
      'email.smtp.host': 'smtp.zeptomail.com',
      'email.smtp.port': 587,
      'email.smtp.secure': false,
      'email.smtp.user': 'emailapikey',
      'email.smtp.pass': 'REDACTED',
      'email.fromName': 'Zentuva',
      'email.fromEmail': 'noreply@zentuva.test',
      ...overrides,
    };
    return { get: jest.fn((key: string) => values[key]) } as unknown as ConfigService;
  }

  const baseMessage = {
    fromEmail: 'noreply@zentuva.test',
    fromName: 'Zentuva',
    toEmail: 'ajayijohnson68@gmail.com',
    subject: 'Test',
    text: 'Test body',
    correlationId: 'delivery-1',
  };

  beforeEach(() => {
    sendMail.mockReset();
  });

  describe('loadSmtpConfig / construction', () => {
    it('throws SmtpConfigurationError listing every missing field, without leaking any value', () => {
      const config = makeConfig({ 'email.smtp.host': undefined, 'email.smtp.pass': undefined });
      expect(() => loadSmtpConfig(config)).toThrow(SmtpConfigurationError);
      try {
        loadSmtpConfig(config);
      } catch (error) {
        expect((error as Error).message).toContain('SMTP_HOST');
        expect((error as Error).message).toContain('SMTP_PASS');
        expect((error as Error).message).not.toContain('REDACTED');
      }
    });

    it('constructs successfully when every required field is present', () => {
      const config = makeConfig();
      expect(() => new SmtpEmailProvider(config)).not.toThrow();
    });
  });

  describe('send', () => {
    it('returns ACCEPTED with the provider message id on success', async () => {
      sendMail.mockResolvedValue({ messageId: '<abc123@zeptomail>' });
      const provider = new SmtpEmailProvider(makeConfig());
      const result = await provider.send(baseMessage);
      expect(result).toEqual({ outcome: 'ACCEPTED', providerMessageId: '<abc123@zeptomail>' });
    });

    it('passes the correlation id as a header for provider-side traceability', async () => {
      sendMail.mockResolvedValue({ messageId: '<abc123@zeptomail>' });
      const provider = new SmtpEmailProvider(makeConfig());
      await provider.send(baseMessage);
      expect(sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: { 'X-Zentuva-Correlation-Id': 'delivery-1' },
          to: baseMessage.toEmail,
          subject: 'Test',
        }),
      );
    });

    it('maps an authentication failure to a TERMINAL_FAILURE with no credentials in the message', async () => {
      sendMail.mockRejectedValue({
        code: 'EAUTH',
        message: 'Invalid login: 535 5.7.8 REDACTED-SECRET',
      });
      const provider = new SmtpEmailProvider(makeConfig());
      const result = await provider.send(baseMessage);
      expect(result.outcome).toBe('TERMINAL_FAILURE');
      expect(result.errorCategory).toBe('SMTP_AUTH');
      expect(result.errorMessage).not.toContain('REDACTED-SECRET');
    });

    it('maps a connection failure to a RETRYABLE_FAILURE', async () => {
      sendMail.mockRejectedValue({ code: 'ECONNECTION', message: 'connect ECONNREFUSED' });
      const provider = new SmtpEmailProvider(makeConfig());
      const result = await provider.send(baseMessage);
      expect(result.outcome).toBe('RETRYABLE_FAILURE');
      expect(result.errorCategory).toBe('SMTP_CONNECTION');
    });

    it('maps a 5xx SMTP response code to a TERMINAL_FAILURE', async () => {
      sendMail.mockRejectedValue({ responseCode: 550, command: 'RCPT TO' });
      const provider = new SmtpEmailProvider(makeConfig());
      const result = await provider.send(baseMessage);
      expect(result.outcome).toBe('TERMINAL_FAILURE');
      expect(result.errorCategory).toBe('SMTP_REJECTED');
    });

    it('maps a 4xx SMTP response code to a RETRYABLE_FAILURE', async () => {
      sendMail.mockRejectedValue({ responseCode: 450, command: 'RCPT TO' });
      const provider = new SmtpEmailProvider(makeConfig());
      const result = await provider.send(baseMessage);
      expect(result.outcome).toBe('RETRYABLE_FAILURE');
      expect(result.errorCategory).toBe('SMTP_TRANSIENT');
    });

    it('defaults an unrecognized failure to RETRYABLE_FAILURE rather than giving up immediately', async () => {
      sendMail.mockRejectedValue(new Error('something unexpected'));
      const provider = new SmtpEmailProvider(makeConfig());
      const result = await provider.send(baseMessage);
      expect(result.outcome).toBe('RETRYABLE_FAILURE');
      expect(result.errorCategory).toBe('SMTP_UNKNOWN');
    });

    it('never returns providerMessageId on a failure', async () => {
      sendMail.mockRejectedValue({ code: 'EAUTH' });
      const provider = new SmtpEmailProvider(makeConfig());
      const result = await provider.send(baseMessage);
      expect(result.providerMessageId).toBeUndefined();
    });
  });
});
