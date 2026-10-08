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
    // Sprint 40.5 — the real deployment's `.env` already carries
    // `WHATSAPP_TOKEN`/`WHATSAPP_GRAPH_API_VERSION`/`WHATSAPP_GRAPH_API_BASE_URL`
    // (separate base+version) rather than Sprint 29's original
    // `WHATSAPP_ACCESS_TOKEN`/`WHATSAPP_API_BASE_URL` (combined) names. Both
    // conventions are honored here — the Sprint 40.5 names take priority when
    // present, the Sprint 29 names remain a fallback — so neither an older
    // environment nor the new one needs to change anything to boot. Never
    // renamed/removed: the brief's own instruction is "use what's already in
    // .env," not "migrate .env."
    apiBaseUrl:
      process.env.WHATSAPP_GRAPH_API_BASE_URL && process.env.WHATSAPP_GRAPH_API_VERSION
        ? `${process.env.WHATSAPP_GRAPH_API_BASE_URL}/${process.env.WHATSAPP_GRAPH_API_VERSION}`
        : (process.env.WHATSAPP_API_BASE_URL ?? 'https://graph.facebook.com/v20.0'),
    accessToken: process.env.WHATSAPP_TOKEN ?? process.env.WHATSAPP_ACCESS_TOKEN,
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
    // Sprint 40.5 — Real Meta WhatsApp Cloud API Foundation
    // (docs/domains/whatsapp.md). Never logged, never returned from any API
    // response as-is — same contract as `accessToken` above.
    webhookVerifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
    // Optional — Meta's `X-Hub-Signature-256` webhook signature is computed
    // with the Meta APP secret, a DIFFERENT credential from the access
    // token above, and one this deployment's `.env` does not currently set.
    // `whatsapp-webhook.controller.ts` logs a loud warning and skips
    // signature verification when this is unset, rather than silently
    // pretending the webhook is authenticated — see its own doc comment and
    // docs/sprint-40.5-completion-report.md "Limitations."
    appSecret: process.env.WHATSAPP_APP_SECRET,
    // Sprint 40.5 — resolves which tenant a BRAND-NEW WhatsApp contact (one
    // with no existing `Consumer` row in any organisation) belongs to, since
    // this deployment's single Meta WhatsApp Business phone number is shared
    // across every tenant rather than provisioned one-per-organisation (a
    // real multi-tenant WhatsApp Business Account setup is out of this
    // sprint's scope — see the completion report). A RETURNING contact is
    // always resolved by matching `Consumer.normalizedPhone` instead; this
    // default is only ever consulted for a conversation nobody has seen
    // before.
    defaultOrganisationId: process.env.WHATSAPP_DEFAULT_ORGANISATION_ID,
  },
  webBaseUrl: process.env.WEB_BASE_URL ?? 'http://localhost:3000',
  opay: {
    // Sprint 35 — D2C OPay Payment Integration. `secretKey`/`publicKey`
    // never logged, never returned from any API response as-is — see
    // docs/domains/d2c.md "Security."
    environment: (process.env.OPAY_ENVIRONMENT ?? 'sandbox') as 'sandbox' | 'production',
    apiBaseUrl: process.env.OPAY_API_BASE_URL ?? 'https://testapi.opaycheckout.com',
    merchantId: process.env.OPAY_MERCHANT_ID,
    publicKey: process.env.OPAY_PUBLIC_KEY,
    secretKey: process.env.OPAY_SECRET_KEY,
    // A local placeholder cannot receive a real OPay callback — see
    // docs/domains/d2c.md "Webhook — Local Development." Configurable so a
    // developer can point it at a temporary HTTPS tunnel without a code
    // change, and so production can point it at the real public API host.
    webhookUrl: process.env.OPAY_WEBHOOK_URL ?? 'http://localhost:4000/api/payments/opay/webhook',
  },
  d2cOperationalAlerts: {
    // Sprint 43 — D2C Operations, Notifications & Production Hardening
    // (docs/domains/d2c.md "Operational Exceptions"). Configurable rather than
    // scattered hardcoded constants — consumed by `D2COperationalExceptionsService`.
    assignedHours: parseFloat(process.env.D2C_OPERATIONAL_ALERT_ASSIGNED_HOURS ?? '24'),
    preparingMinutes: parseFloat(process.env.D2C_OPERATIONAL_ALERT_PREPARING_MINUTES ?? '120'),
    readyForCollectionHours: parseFloat(
      process.env.D2C_OPERATIONAL_ALERT_READY_FOR_COLLECTION_HOURS ?? '48',
    ),
    paymentPendingHours: parseFloat(process.env.D2C_OPERATIONAL_ALERT_PAYMENT_PENDING_HOURS ?? '2'),
  },
  whatsappHttpTimeoutMs: parseInt(process.env.WHATSAPP_HTTP_TIMEOUT_MS ?? '10000', 10),
});
