import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

import {
  EmailMessage,
  EmailProvider,
  EmailProviderOutcome,
  EmailProviderResult,
} from '../ports/email-provider.port';

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
}

/** Thrown at construction time — never at request time — when `EMAIL_PROVIDER_MODE=smtp`
 *  but a required field is missing. Sprint 28 Add-On §C: "Do not silently fall back
 *  from a configured real provider to the local provider while reporting success." A
 *  NestJS provider factory throwing here stops the module (and therefore the app) from
 *  starting, which is the loudest, safest possible signal — never a route that quietly
 *  no-ops or falls back. The message lists only WHICH fields are missing, never any
 *  value. */
export class SmtpConfigurationError extends Error {}

export function loadSmtpConfig(config: ConfigService): SmtpConfig {
  const host = config.get<string | undefined>('email.smtp.host');
  const port = config.get<number | undefined>('email.smtp.port');
  const secure = config.get<boolean>('email.smtp.secure') ?? false;
  const user = config.get<string | undefined>('email.smtp.user');
  const pass = config.get<string | undefined>('email.smtp.pass');
  const fromName = config.get<string | undefined>('email.fromName');
  const fromEmail = config.get<string | undefined>('email.fromEmail');

  const missing: string[] = [];
  if (!host) missing.push('SMTP_HOST');
  if (!port) missing.push('SMTP_PORT');
  if (!user) missing.push('SMTP_USER');
  if (!pass) missing.push('SMTP_PASS');
  if (!fromName) missing.push('MAIL_FROM_NAME');
  if (!fromEmail) missing.push('MAIL_FROM_EMAIL');
  if (missing.length > 0) {
    throw new SmtpConfigurationError(
      `EMAIL_PROVIDER_MODE=smtp requires the following environment variable(s), which are missing or empty: ${missing.join(', ')}. Set EMAIL_PROVIDER_MODE=local to use the safe development provider instead.`,
    );
  }

  return { host: host!, port: port!, secure, user: user!, pass: pass! };
}

/**
 * Sprint 28 Add-On "Real ZeptoMail Email Verification." A real SMTP provider built
 * on `nodemailer`, compatible with any standards-conforming SMTP relay — ZeptoMail's
 * SMTP endpoint specifically, but nothing here is ZeptoMail-specific (no proprietary
 * API calls; `ZEPTOMAIL_API_KEY` is deliberately unread — see `env.validation.ts`'s
 * doc comment). Only constructed when `EMAIL_PROVIDER_MODE=smtp`
 * (`email-provider.module.ts`).
 *
 * Security: never logs `SMTP_PASS`, never includes it in a thrown/returned error —
 * every error surfaced by {@link send} is a short, hand-built safe string (SMTP
 * response code + command name only), never the raw `nodemailer` exception's own
 * `message`, which for some failure modes can echo back transport-level detail.
 */
@Injectable()
export class SmtpEmailProvider implements EmailProvider {
  readonly name = 'smtp';
  private readonly logger = new Logger(SmtpEmailProvider.name);
  private readonly transporter: nodemailer.Transporter;
  private readonly fromEmail: string;
  private readonly fromName: string;

  constructor(@Inject(ConfigService) config: ConfigService) {
    const smtp = loadSmtpConfig(config);
    this.fromEmail = config.get<string>('email.fromEmail')!;
    this.fromName = config.get<string>('email.fromName')!;
    this.transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: { user: smtp.user, pass: smtp.pass },
    });
    this.logger.log(
      `SMTP email provider configured (host configured: yes, port configured: yes, secure: ${smtp.secure}).`,
    );
  }

  async send(message: EmailMessage): Promise<EmailProviderResult> {
    try {
      const info = await this.transporter.sendMail({
        from: `"${message.fromName || this.fromName}" <${message.fromEmail || this.fromEmail}>`,
        to: message.toName ? `"${message.toName}" <${message.toEmail}>` : message.toEmail,
        replyTo: message.replyTo,
        subject: message.subject,
        text: message.text,
        html: message.html,
        headers: { 'X-Zentuva-Correlation-Id': message.correlationId },
      });
      this.logger.debug(`SMTP accepted message ${info.messageId} for ${message.correlationId}`);
      return { outcome: 'ACCEPTED', providerMessageId: info.messageId };
    } catch (error) {
      return this.mapError(error);
    }
  }

  /** Classifies a `nodemailer`/SMTP-transport error into retryable vs. terminal —
   *  Sprint 28 §8.2 "Retryable provider failures... Terminal provider failures."
   *  Never re-throws or returns the raw error object/message: only a short,
   *  pre-written safe description plus the numeric SMTP response code (never
   *  connection strings or credentials, which nodemailer error objects do not embed
   *  in this codebase's connection style — explicit `host`/`port`/`auth` fields, not
   *  a connection URL — but this method still never trusts `error.message`
   *  verbatim, as defense in depth). */
  private mapError(error: unknown): EmailProviderResult {
    const err = error as {
      code?: string;
      responseCode?: number;
      command?: string;
    };
    const code = err?.code;
    const responseCode = err?.responseCode;
    const command = err?.command;

    let outcome: EmailProviderOutcome;
    let errorCategory: string;

    if (code === 'EAUTH') {
      outcome = 'TERMINAL_FAILURE';
      errorCategory = 'SMTP_AUTH';
    } else if (
      code === 'ECONNECTION' ||
      code === 'ECONNREFUSED' ||
      code === 'ETIMEDOUT' ||
      code === 'ESOCKET' ||
      code === 'EDNS'
    ) {
      outcome = 'RETRYABLE_FAILURE';
      errorCategory = 'SMTP_CONNECTION';
    } else if (typeof responseCode === 'number' && responseCode >= 500) {
      outcome = 'TERMINAL_FAILURE';
      errorCategory = 'SMTP_REJECTED';
    } else if (typeof responseCode === 'number' && responseCode >= 400) {
      outcome = 'RETRYABLE_FAILURE';
      errorCategory = 'SMTP_TRANSIENT';
    } else if (code === 'EENVELOPE' || code === 'EMESSAGE') {
      outcome = 'TERMINAL_FAILURE';
      errorCategory = 'SMTP_INVALID_MESSAGE';
    } else {
      // Unknown failure mode — default to retryable up to the normal attempt limit
      // rather than giving up immediately (Sprint 27.1's own precedent: "every
      // failure is currently treated as retryable — no error taxonomy exists to
      // distinguish transient from permanent" for every OTHER unclassified case).
      outcome = 'RETRYABLE_FAILURE';
      errorCategory = 'SMTP_UNKNOWN';
    }

    this.logger.warn(
      `SMTP send failed: category=${errorCategory} responseCode=${responseCode ?? 'n/a'} command=${command ?? 'n/a'}`,
    );

    return {
      outcome,
      errorCategory,
      errorMessage: `SMTP failure (${errorCategory})${responseCode ? `, response code ${responseCode}` : ''}${command ? ` during ${command}` : ''}.`,
    };
  }
}
