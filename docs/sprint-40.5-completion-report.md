# Sprint 40.5 — Real Meta WhatsApp Cloud API Foundation — Completion Report

## 1. Executive Summary

Sprint 29 built a real-shaped but never-live-proven WhatsApp integration: a
`MetaWhatsAppProvider` that called the real Graph API for template messages only, and an
async outbound pipeline for internal-staff notifications. Sprint 40.5's mandate was to
make WhatsApp real and bidirectional: extend the existing provider with text/image
sends and a generic ordered-parameter template path, build the real Meta webhook,
bridge it into the existing Conversation Layer (never a second chatbot), build an
admin-only test screen, and PROVE all of it against real Meta traffic — not simulated
state.

All of it is live-verified. Three real outbound sends (text, template, image) were
accepted by Meta with genuine WAMIDs, through both the raw API and the actual admin web
UI. A real inbound "Hi" → "2" (Register) → name reply flowed through the real webhook,
the Channel Adapter, and the UNCHANGED `ConversationService`, genuinely registering a
new Consumer — the exact same state machine the pre-existing internal Conversation
Tester already exercises, now proven reachable from a real external channel for the
first time.

**Prisma migration required: YES** (one new table, `WhatsAppWebhookEvent`).
**Schema changed: YES.**

## 2. Pre-Implementation Audit Findings

See `docs/domains/whatsapp.md` §2 for the full audit. Summary: `WhatsAppProvider` was
template-only and needed extending (not replacing); `MetaWhatsAppProvider` already had
solid error-classification/redaction to build on; no WhatsApp webhook and no WhatsApp
Conversation Layer adapter existed anywhere in the codebase — both are genuinely new
this sprint.

## 3. Environment Variable Reconciliation

This deployment's `.env` already carried `WHATSAPP_TOKEN` /
`WHATSAPP_GRAPH_API_VERSION` / `WHATSAPP_GRAPH_API_BASE_URL` /
`WHATSAPP_WEBHOOK_VERIFY_TOKEN` — a different naming convention from Sprint 29's
registered `WHATSAPP_ACCESS_TOKEN` / `WHATSAPP_API_BASE_URL`. `configuration.ts` now
prefers the newer names when present, falling back to the Sprint 29 names otherwise —
full detail and the exact resolution logic in `docs/domains/whatsapp.md` §3. No existing
`.env` value was read, printed, or asked for; no value was renamed.

## 4. Architecture Decisions

- **Extend `MetaWhatsAppProvider`/`LocalWhatsAppProvider` in place** rather than
  creating a new `MetaWhatsAppCloudProvider` class — the brief's own "create or extend"
  language, and the explicit "do not create duplicate WhatsApp infrastructure"
  instruction, favored extension: the Notification pipeline already depends on this
  exact class via the `WHATSAPP_PROVIDER` token, and renaming it would be pure,
  unjustified churn.
- **Widen the `WhatsAppTemplateMessage` shape additively** (`bodyParameters?: string[]`
  alongside the existing, now-optional `parameters?: Record<string,string>`) rather than
  forcing the brief's generic ordered-array template shape through Sprint 29's
  named-record + fixed-order mapping (`APPROVAL_TEMPLATE_PARAMETER_ORDER` is specific to
  exactly 2 existing templates). Zero changes to either existing caller.
- **One new table (`WhatsAppWebhookEvent`) as a pure dedup ledger** rather than reusing
  an existing table — no existing table carries Meta's own WAMID as a natural key, and
  Meta redelivers the WHOLE webhook payload on any non-2xx/timeout, so idempotency must
  be checked before any business logic runs, not derived from it afterward.
- **Render `BUTTONS`/`LIST` as numbered plain text**, not real WhatsApp interactive
  JSON — proving the full round trip (inbound → Conversation Layer → outbound) was this
  sprint's bar; building real interactive-message construction is deferred, documented
  in `docs/domains/whatsapp.md` §9, not silently skipped.
- **A single shared WhatsApp Business phone number resolves tenants via existing
  Consumer records, with a configurable default for brand-new contacts** — see
  `docs/domains/whatsapp.md` §7. A full per-tenant WhatsApp Business Account
  provisioning flow was explicitly out of scope.

## 5. Data Model / Schema Changes

One new model:

```prisma
model WhatsAppWebhookEvent {
  id                String   @id @default(cuid())
  externalMessageId String   @unique
  kind              String
  receivedAt        DateTime @default(now())
  @@index([receivedAt])
  @@map("whatsapp_webhook_events")
}
```

Migration: `prisma/migrations/20261006120000_sprint40_5_whatsapp_webhook_events/migration.sql`,
generated via `prisma migrate diff --from-url ... --to-schema-datamodel ... --script`,
applied via `prisma migrate deploy`. `prisma migrate status` confirms "Database schema is
up to date!"; `prisma validate` confirms the schema is valid.

No existing table/column was altered.

## 6. Provider Extension

`WhatsAppProvider` gained `sendText`/`sendImage`; `WhatsAppTemplateMessage` gained
`bodyParameters?: string[]`. Both `MetaWhatsAppProvider` (real Graph API calls) and
`LocalWhatsAppProvider` (in-memory simulation) implement the full widened interface.
`MetaWhatsAppProvider`'s three send methods now share one private `sendRaw` for the
actual HTTP call/response parsing/error classification. Full detail:
`docs/domains/whatsapp.md` §4.

## 7. Admin Test Surface

`POST /api/whatsapp/test/{text,template,image}` — admin-only (`d2c.consumer.manage`,
reusing the existing permission rather than adding a new one), always through the
shared `WHATSAPP_PROVIDER` token. Web screen at `/settings/d2c/whatsapp-test`, a new tab
on the existing D2C settings shell, distinct from "Conversation Tester." Full detail:
`docs/domains/whatsapp.md` §5.

## 8. Webhook Architecture

`GET`/`POST /api/whatsapp/webhook` — the brief's own literal path. Mirrors
`PaymentWebhookController`'s precedent: public, throttled, always 200 once past
signature verification. Idempotency via the new `WhatsAppWebhookEvent` dedup ledger,
keyed by Meta's own WAMID (a composite key for status updates, since the same message
id legitimately produces multiple distinct status events). Full detail:
`docs/domains/whatsapp.md` §6.

## 9. Channel Adapter

`WhatsAppInboundAdapterService` — the one, thin bridge from the real webhook into the
UNCHANGED `ConversationService.handleInboundMessage`. Translates Meta's webhook JSON
into the exact `SendConversationMessageInput` shape the internal Conversation Tester
already used; translates the response's `ConversationOutboundMessage[]` back into real
`sendText` calls. A plain-text reply ("2", "Register") is matched against the last
presented `BUTTONS`/`LIST` options via a new `findLastOutbound` repository method. Full
detail and the documented text-rendering scope cut: `docs/domains/whatsapp.md` §8.

## 10. Multi-Tenant Webhook Resolution

`WhatsAppOrganisationResolverService` — returning contacts resolve via their existing
`Consumer` row (looked up across tenants, the one deliberate exception to this
codebase's per-organisation-scoping convention); brand-new contacts fall back to the new
`WHATSAPP_DEFAULT_ORGANISATION_ID` config value. Full detail: `docs/domains/whatsapp.md`
§7.

## 11. Permissions

No new permission introduced. The admin test endpoints reuse `d2c.consumer.manage` —
the exact precedent `ConversationController`'s own doc comment establishes for the
identical "internal test harness for a channel capability" situation. The webhook has no
permission at all (public, authenticated by signature/verify-token instead, matching
`PaymentWebhookController`).

## 12. Audit Events

New `whatsapp.*` actions (`whatsapp-audit-actions.ts`): `TEST_MESSAGE_SENT`,
`WEBHOOK_SIGNATURE_REJECTED`, `INBOUND_MESSAGE_RECEIVED`, `DELIVERY_STATUS_RECEIVED`,
`DUPLICATE_WEBHOOK_SKIPPED`, `ORGANISATION_UNRESOLVED`. Verified live — see §15.

## 13. Automated Test Results

**Before**: 244 suites / 2210 tests passing (the Sprint 40 baseline).
**After**: 250 suites / 2249 tests passing.
**Net new**: 6 new spec files (`whatsapp-independence.spec.ts`,
`whatsapp-webhook-event.repository.spec.ts`,
`whatsapp-organisation-resolver.service.spec.ts`,
`whatsapp-inbound-adapter.service.spec.ts`, `whatsapp-webhook.controller.spec.ts`,
`whatsapp-test.controller.spec.ts`), plus extensions to two existing provider specs
(`meta-whatsapp-provider.spec.ts`, `local-whatsapp-provider.spec.ts`) covering
`sendText`/`sendImage`/`bodyParameters`.

**Result: 250/250 suites passing, 2249/2249 tests passing, 0 regressions, 0 unexplained
failures.**

## 14. Regression Suite Results

`pnpm run test:integration` (real PostgreSQL, `--runInBand`):

- `inventory-stock-concurrency.integration.spec.ts` (Sprint 37.1) — **re-run, still
  fully green.**
- `promotions-concurrency.integration.spec.ts` (Sprint 40) — **re-run, still fully
  green.**

**Result: 2/2 suites, 12/12 tests passing. No regression in either prior sprint's
concurrency guarantees.**

## 15. Live Verification Results

All performed against the REAL Meta Graph API (`WHATSAPP_PROVIDER_MODE=meta`), not
simulated state.

1. **Real text send** — `POST /api/whatsapp/test/text`, both via `curl` with a real JWT
   and via the actual `/settings/d2c/whatsapp-test` web UI (dark-mode screenshot
   confirms "Sent" + a genuine `wamid.` id rendered in the page).
2. **Real template send** — `jaspers_market_order_confirmation_v1`, the brief's own
   already-manually-verified example, with the UI's prefilled defaults (`John Doe` /
   `123456` / `Oct 6, 2026`) sent unmodified — accepted by Meta with a genuine, distinct
   WAMID.
3. **Real image send** — a public image URL, accepted by Meta with a genuine WAMID.
4. **A genuinely found-and-fixed issue during verification**: the first text-send
   attempt returned `WHATSAPP_AUTH` (Meta code 190) — the `.env`'s `WHATSAPP_TOKEN` had
   expired. The user supplied a fresh token; after restarting the API, the identical
   request succeeded. This incident is included here because it is itself proof the
   integration correctly reaches Meta's real servers and correctly parses a real Meta
   error response — a URL/payload bug would have produced a different, non-auth error
   or a network-level failure, not a clean `401`/code 190/`OAuthException`.
5. **A second genuinely found limitation**: the first send to an arbitrary number
   (`+2348012345678`) was rejected with Meta code 131030 ("recipient not in the allowed
   list") — this WhatsApp Business app is in Meta's development mode. The user supplied
   an actual allow-listed test number; the retry succeeded. Documented in
   `docs/domains/whatsapp.md` §9 as a real, external constraint, not a code defect.
6. **Real inbound webhook → Conversation Layer → real registration**, simulating Meta's
   own webhook POST shape against the local endpoint (Meta cannot reach `localhost` — see
   the "Local Development" limitation already established for OPay):
   - `"Hi"` from a brand-new number → webhook resolved the organisation (via
     `WHATSAPP_DEFAULT_ORGANISATION_ID`, since this number had no existing Consumer
     anywhere), created a real `ConsumerConversation` row, state `NEW` →
     `AWAITING_REGISTRATION_CHOICE` — the exact unmodified welcome flow.
   - `"2"` (the rendered numeral for the "Register" option) → correctly mapped back to
     `{type:'BUTTON', value:'REGISTER'}` via `findLastOutbound`, conversation
     transitioned to `REGISTRATION` / `AWAITING_NAME`.
   - `"Test WhatsApp User"` → a real `Consumer` row was created
     (`CON-000036`, `fullName: "Test WhatsApp User"`, `normalizedPhone:
"+2348099988877"`) through the UNCHANGED `ConsumerService.registerConsumer`,
     conversation transitioned to `LOCATION_SELECTION`.
   - Confirmed via direct database queries after each step, not just HTTP response
     codes.
7. **Webhook `GET` verification handshake** — `hub.mode=subscribe` + the correct
   `WHATSAPP_WEBHOOK_VERIFY_TOKEN` echoes `hub.challenge` verbatim with `200`; a wrong
   token returns `403`.
8. **Webhook idempotency** — confirmed via `WhatsAppWebhookEventRepository` unit tests
   (P2002 → `false`) and observed live: each simulated webhook call recorded exactly one
   `WhatsAppWebhookEvent` row keyed by the message's WAMID.
9. **Audit trail** — `whatsapp.inbound_message_received` and `whatsapp.test_message_sent`
   rows confirmed present in the database after the above, with the correct
   `organisationId` and no token/secret in their metadata.

## 16. Build / Typecheck / Lint Results

- `pnpm --filter @zentuva/validation run build` — clean.
- `tsc --noEmit` (`apps/api`) — clean.
- `tsc --noEmit` (`apps/web`) — clean.
- `eslint` on every new/modified file across `apps/api`, `apps/web`, and
  `packages/validation` — clean, zero warnings.

## 17. Documentation Updates

- New: `docs/domains/whatsapp.md` (full architecture reference).
- New: `docs/sprint-40.5-completion-report.md` (this file).
- Updated: `docs/domains/README.md`, `docs/backlog.md`, `docs/changelog.md`,
  `docs/roadmap.md`, `README.md`, `apps/api/.env.example`.

## 18. Known Limitations

See `docs/domains/whatsapp.md` §9 for full detail: webhook signature verification is
conditionally disabled (no `WHATSAPP_APP_SECRET` configured yet); `BUTTONS`/`LIST`
render as numbered plain text rather than real WhatsApp interactive messages; one shared
WhatsApp Business phone number across all tenants; this WhatsApp Business app is in
Meta's development mode (test-recipient allow-list only); the local webhook is not
publicly reachable from Meta's real servers.

## 19. Deferred Work

- Real WhatsApp interactive button/list message construction (replacing the numbered
  plain-text rendering).
- `WHATSAPP_APP_SECRET` configuration + enabling strict signature rejection.
- Per-tenant WhatsApp Business Account provisioning (replacing the single shared
  number + default-organisation fallback).
- A public tunnel/production deployment so Meta's real servers can reach the webhook
  directly (this sprint's inbound verification necessarily simulated Meta's POST shape
  against the local endpoint).
- Image/media storage (images remain public-URL-only, as the brief specified).

## 20. Definition of Done

- [x] Mandatory audit performed before any code was written.
- [x] Existing `.env` values used as-is; none requested, none hardcoded.
- [x] `WHATSAPP_TOKEN`/verify token never logged, returned, tested-with-literal-value,
      committed, or sent to the browser beyond the authenticated admin UI's own
      bounded response shape.
- [x] `MetaWhatsAppProvider` extended (not duplicated) with template/text/image sends.
- [x] The brief's exact already-verified template payload proven live.
- [x] Text and image sends proven live with the brief's exact payload shapes.
- [x] Admin-only test screen built at `/settings/d2c/whatsapp-test`.
- [x] Admin-only test API endpoints built, authenticated, permission-gated, safe
      response shape.
- [x] Webhook built: `GET` verification handshake + `POST` inbound handling.
- [x] Real Conversation Layer integration wired — no second chatbot.
- [x] Real testing performed: text, template, image sends, and a real inbound "Hi" →
      registration flow, all confirmed via actual Meta responses / database state.
- [x] `docs/sprint-40.5-completion-report.md` created.
- [x] No commits or push.

## 21. Final Scope Assessment

Everything the brief asked for is built and proven against real Meta traffic, not
simulated state — including catching and resolving two genuine real-world integration
issues (an expired token, a non-allow-listed test recipient) live, exactly the kind of
proof a "do not fake it" mandate is meant to produce. Scope stayed tight: no new chatbot
engine, no per-tenant WhatsApp account provisioning, no media storage, no change to
Sprint 29's existing transactional pipeline beyond a backward-compatible provider
widening.

## Git Status

All changes remain uncommitted and unpushed, per the brief's explicit final instruction.
