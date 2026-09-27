export default () => ({
  port: parseInt(process.env.PORT ?? '4000', 10),
  database: {
    url: process.env.DATABASE_URL,
  },
  redis: {
    url: process.env.REDIS_URL,
  },
  auth: {
    bcryptSaltRounds: parseInt(process.env.BCRYPT_SALT_ROUNDS ?? '12', 10),
    jwtAccessSecret: process.env.JWT_ACCESS_SECRET,
    jwtRefreshSecret: process.env.JWT_REFRESH_SECRET,
    jwtAccessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
    jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '30d',
    maxLoginAttempts: parseInt(process.env.MAX_LOGIN_ATTEMPTS ?? '5', 10),
  },
  uploads: {
    dir: process.env.UPLOAD_DIR ?? 'uploads',
    publicUrl: process.env.API_PUBLIC_URL ?? 'http://localhost:4000',
    maxFileSizeBytes: parseInt(
      process.env.UPLOAD_MAX_FILE_SIZE_BYTES ?? String(2 * 1024 * 1024),
      10,
    ),
    // Sprint 30 — Recruitment & Candidate Interview Management Foundation
    // (candidate resume/CV uploads, a larger cap than the 2MB image default).
    maxResumeFileSizeBytes: parseInt(
      process.env.UPLOAD_MAX_RESUME_FILE_SIZE_BYTES ?? String(5 * 1024 * 1024),
      10,
    ),
  },
  finance: {
    // Sprint 6 — a configurable *suggested default*, never hardcoded into invoice
    // calculation logic; whatever rate is actually used gets permanently snapshotted
    // onto InvoiceItem, never recomputed later. Not a tax engine.
    defaultTaxRatePercent: parseFloat(process.env.FINANCE_DEFAULT_TAX_RATE_PERCENT ?? '7.5'),
  },
  email: {
    // Sprint 28 — never logged, never returned from any API response as-is; see
    // docs/architecture/email-delivery.md "Configuration."
    providerMode: (process.env.EMAIL_PROVIDER_MODE ?? 'local') as 'local' | 'smtp',
    webPublicUrl: process.env.WEB_PUBLIC_URL ?? 'http://localhost:3000',
    smtp: {
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : undefined,
      secure: process.env.SMTP_SECURE === 'true',
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    fromName: process.env.MAIL_FROM_NAME,
    fromEmail: process.env.MAIL_FROM_EMAIL,
  },
  whatsapp: {
    // Sprint 29 — never logged, never returned from any API response as-is;
    // see docs/architecture/whatsapp-delivery.md "Configuration."
    providerMode: (process.env.WHATSAPP_PROVIDER_MODE ?? 'local') as 'local' | 'meta',
    apiBaseUrl: process.env.WHATSAPP_API_BASE_URL ?? 'https://graph.facebook.com/v20.0',
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID,
    approvalTemplateName:
      process.env.WHATSAPP_APPROVAL_TEMPLATE_NAME ?? 'zentuva_approval_required',
    approvalTemplateLanguage: process.env.WHATSAPP_APPROVAL_TEMPLATE_LANGUAGE ?? 'en_US',
    // Sprint 30 — Recruitment & Candidate Interview Management Foundation.
    interviewScheduledTemplateName:
      process.env.WHATSAPP_INTERVIEW_SCHEDULED_TEMPLATE_NAME ?? 'zentuva_interview_scheduled',
    interviewScheduledTemplateLanguage:
      process.env.WHATSAPP_INTERVIEW_SCHEDULED_TEMPLATE_LANGUAGE ?? 'en_US',
  },
});
