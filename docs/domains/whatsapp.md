# Real Meta WhatsApp Cloud API Foundation (Sprint 40.5)

## 1. Domain Purpose

Sprint 29 (`docs/domains/notifications.md` §20–24) built the WhatsApp Notification
Delivery Foundation: an async, queue-like pipeline (`WhatsAppDelivery`) that sends
pre-approved TEMPLATE messages to **Users** (internal staff) when a `Notification` is
created — approvals, interview schedules. That pipeline, and the `MetaWhatsAppProvider`/
`LocalWhatsAppProvider` pair it introduced, are UNCHANGED by this sprint except for one
addition: the provider now also knows how to send free-form text and images, and to
build a template's body parameters from a plain ordered array.

This sprint adds what Sprint 29 deliberately deferred: **real, synchronous,
bidirectional** WhatsApp messaging —

- An admin-only test screen/API that sends a real message (text, template, or image)
  through whichever provider `WHATSAPP_PROVIDER_MODE` currently selects, and shows the
  real Meta response.
- A real Meta webhook (`GET`/`POST /api/whatsapp/webhook`) that receives inbound
  consumer messages and delivery-status updates.
- A **Channel Adapter** (`WhatsAppInboundAdapterService`) that is the first real bridge
  between that webhook and the existing, channel-neutral Conversation Layer (Sprint 33,
  `docs/domains/d2c.md` §"Conversation Architecture") — so a real WhatsApp "Hi" now
  flows all the way through `ConversationService.handleInboundMessage` and back out as a
  real WhatsApp reply.

Nothing in `ConversationService` changed to make this possible — the adapter is a thin
translator, never a second conversational engine (verified executably, see
`whatsapp-independence.spec.ts`).

## 2. Pre-Implementation Audit — What Already Existed

Before writing any code, this sprint audited Sprint 29's WhatsApp delivery system, the
Conversation Layer, and the existing webhook/idempotency pattern (`PaymentWebhookController`,
Sprint 35). Findings:

- `WhatsAppProvider` (`notifications/ports/whatsapp-provider.port.ts`) was
  TEMPLATE-ONLY (`sendTemplate`) — extended, never duplicated.
- `MetaWhatsAppProvider` already called the real Graph API `.../messages` endpoint for
  templates, already normalized errors, already redacted phone numbers and never logged
  the token — extended in place, same class, same DI token.
- `LocalWhatsAppProvider`/the `WHATSAPP_PROVIDER` mode-switch factory
  (`whatsapp-provider.module.ts`) needed no structural change — both providers now
  satisfy the same widened interface.
- No WhatsApp webhook and no WhatsApp channel adapter existed anywhere in this codebase
  — both are genuinely new (confirmed by a full-codebase search, not assumed).
- `ConversationService.handleInboundMessage(organisationId, input)` was already the
  exact, documented entry point a future real adapter should call — the internal
  Conversation Tester (`ConversationController`, Sprint 33) was its only existing
  caller.

## 3. Environment Variable Reconciliation

Sprint 29 registered `WHATSAPP_ACCESS_TOKEN` / `WHATSAPP_API_BASE_URL` (base+version
combined). This deployment's actual `.env` already carries a DIFFERENT set of names —
`WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_GRAPH_API_VERSION`,
`WHATSAPP_GRAPH_API_BASE_URL`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN` — already populated with
real values. `configuration.ts`'s `whatsapp` block now prefers the newer names when
present and falls back to the Sprint 29 names otherwise:

```
accessToken = WHATSAPP_TOKEN ?? WHATSAPP_ACCESS_TOKEN
apiBaseUrl  = (WHATSAPP_GRAPH_API_BASE_URL && WHATSAPP_GRAPH_API_VERSION)
                ? `${WHATSAPP_GRAPH_API_BASE_URL}/${WHATSAPP_GRAPH_API_VERSION}`
                : WHATSAPP_API_BASE_URL ?? 'https://graph.facebook.com/v20.0'
```

`MetaWhatsAppProvider` itself reads only the resolved `whatsapp.accessToken`/
`whatsapp.apiBaseUrl`/`whatsapp.phoneNumberId` config keys — it has no idea which
underlying env var name supplied them, so this reconciliation is invisible past
`configuration.ts`. No existing `.env` entry was renamed or removed.

Two genuinely new config values were added, both optional (nothing required for an
existing environment to keep booting):

- `WHATSAPP_WEBHOOK_VERIFY_TOKEN` — Meta's `GET` handshake token (already present in
  this deployment's `.env`).
- `WHATSAPP_APP_SECRET` — verifies `X-Hub-Signature-256` on `POST` webhook deliveries.
  **Not currently set** in this deployment — see §9 "Known Limitations."
- `WHATSAPP_DEFAULT_ORGANISATION_ID` — see §7 "Multi-Tenant Webhook Resolution."

## 4. Provider Extension

`WhatsAppProvider` gained two new methods, implemented by both `MetaWhatsAppProvider`
and `LocalWhatsAppProvider`:

```ts
sendText(message: { toPhoneNumber, text, correlationId }): Promise<WhatsAppSendResult>
sendImage(message: { toPhoneNumber, imageUrl, caption?, correlationId }): Promise<WhatsAppSendResult>
```

`WhatsAppTemplateMessage.parameters` (the Sprint 29 named-record + fixed-order shape,
used only by `resolveWhatsAppTemplate`'s two existing templates) is now OPTIONAL,
alongside a new optional `bodyParameters?: string[]` — a plain ordered array mapping
directly onto Meta's positional `{{1}}..{{n}}` placeholders, with no per-template
named-order registry required. `MetaWhatsAppProvider.sendTemplate` prefers
`bodyParameters` when present; the two Sprint 29 call sites are untouched and keep using
`parameters`.

All three send methods (`sendTemplate`/`sendText`/`sendImage`) now share one private
`sendRaw` method for the actual `fetch`/response-parsing/error-classification —
previously duplicated only inside `sendTemplate`.

## 5. Admin Test Surface

`POST /api/whatsapp/test/{text,template,image}` (`apps/api/src/d2c/whatsapp/whatsapp-test.controller.ts`)
— admin-only (`JwtAuthGuard` + `PermissionsGuard`, `d2c.consumer.manage`, the SAME
permission `ConversationController`'s own internal test harness reuses, per its
documented "a second permission pair would be redundant" precedent). Always sends
through the SAME `WHATSAPP_PROVIDER` DI token every other caller uses — never a second,
bypassing path straight to `MetaWhatsAppProvider`. Response shape is bounded:
`{success, metaMessageId?, errorCode?}` — never the provider config, never a raw Meta
response body.

The web admin screen, `/settings/d2c/whatsapp-test`
(`apps/web/src/app/(app)/settings/d2c/whatsapp-test/`), is a new tab on the existing
`/settings/d2c` shell, distinct from the pre-existing "Conversation Tester" tab:
Conversation Tester drives the SIMULATED internal `/d2c/conversations/messages`
endpoint (no real WhatsApp traffic); WhatsApp Test sends a REAL message through the
configured provider. Template defaults match the brief's own already-manually-verified
example (`jaspers_market_order_confirmation_v1` / `John Doe` / `123456` / `Oct 6,
2026`).

## 6. Webhook Architecture

`apps/api/src/d2c/whatsapp/whatsapp-webhook.controller.ts`, route `whatsapp` (so
`/api/whatsapp/webhook` — the brief's own literal path, almost certainly already entered
in the Meta App Dashboard's Callback URL field). Mirrors `PaymentWebhookController`
(Sprint 35) exactly: no `JwtAuthGuard` (Meta's servers have no Zentuva session),
`ThrottlerGuard`-rate-limited, `POST` always returns `200` once past signature
verification — even when business logic fails for an individual message — so Meta's own
retry behaviour never hammers a delivery that can never succeed.

- `GET /api/whatsapp/webhook` — Meta's `hub.mode`/`hub.verify_token`/`hub.challenge`
  handshake. Echoes `hub.challenge` back as the exact, unquoted raw body (`@Res()`
  bypasses Nest's default JSON serialization).
- `POST /api/whatsapp/webhook` — verifies `X-Hub-Signature-256` (HMAC-SHA256 over the
  raw body, keyed by `WHATSAPP_APP_SECRET` — see §9), then hands the parsed payload to
  `WhatsAppInboundAdapterService.handleWebhookPayload`.

**Idempotency**: a new `WhatsAppWebhookEvent` table (`externalMessageId` — Meta's own
WAMID — `@unique`) is the dedup ledger. `WhatsAppWebhookEventRepository.tryClaim` is a
bare `create()` guarded by that unique constraint (never a pre-check-then-create) —
exactly the `ConsumerRewardGrant` idempotency recipe from Sprint 40, applied to a pure
dedup ledger. Status updates are deduped by a COMPOSITE key (`${id}:${status}`), since
Meta legitimately sends multiple different status events (sent → delivered → read) for
the same message id — only an exact repeat of the same id+status pair is a true
redelivery.

## 7. Multi-Tenant Webhook Resolution

This deployment has exactly ONE configured Meta WhatsApp Business phone number, shared
across every tenant (a real per-tenant WhatsApp Business Account provisioning flow is
out of this sprint's scope). `WhatsAppOrganisationResolverService` resolves which
organisation an inbound message belongs to:

1. A RETURNING contact (an existing `Consumer` row matching the sender's normalized
   phone, in exactly one organisation) always wins.
2. A phone number registered as a `Consumer` in MORE THAN ONE organisation resolves to
   the most recently created match, logging the ambiguity — a documented limitation of
   the shared-number setup, not a silent guess.
3. A BRAND NEW contact (no existing `Consumer` anywhere) falls back to
   `WHATSAPP_DEFAULT_ORGANISATION_ID`. If unset, resolution fails and the webhook safely
   no-ops (audit-logged as `whatsapp.organisation_unresolved`) rather than guessing.

`ConsumerRepository.findManyByNormalizedPhoneAcrossOrganisations` is the one, explicitly
narrow exception to this codebase's "every repository method scopes by organisationId"
convention — used only by this resolver.

## 8. Channel Adapter

`WhatsAppInboundAdapterService` is the only bridge between the webhook and
`ConversationService`. For each inbound text message: normalizes the sender's phone
(reusing `normalizePhoneNumber` unchanged — Meta's `from` is always already
international, so the `+`-prefixed branch handles it without needing an organisation
country), resolves the organisation, and calls `handleInboundMessage(organisationId,
{channel:'WHATSAPP', externalConversationId, input})` — the exact call shape
`ConversationController`'s own doc comment names as what a real adapter should
replicate.

**Rendering replies as plain text, not real interactive messages** — a deliberate,
documented scope cut. `ConversationOutboundMessage`'s `BUTTONS`/`LIST` types are
rendered as numbered plain text (`"1. Yes, continue\n2. Register"`) rather than Meta's
real interactive button/list JSON. A plain-text reply is matched back against whichever
options were last presented — by exact number or case-insensitive label — via
`ConversationMessageRepository.findLastOutbound` (a new method; the persisted
`payload` on an `OUTBOUND` message is exactly the `ConversationOutboundMessage[]`
array `ConversationService` already writes). A real WhatsApp interactive-message
`button_reply`/`list_reply` is also handled directly via its own stable `id`, with no
history lookup needed, for forward-compatibility with a future real-interactive-message
upgrade.

**Added Sprint 41** — option numbering is GLOBAL across a whole outbound response
batch, never restarting at "1." per message. A single response can legitimately carry
TWO option-bearing messages (e.g. `ConversationService.renderBrowsing`'s product `LIST`
plus a "View Cart & Checkout" `BUTTONS` message once the cart is non-empty) — numbering
each independently made a numeric reply genuinely ambiguous between two separately
numbered WhatsApp bubbles. `sendOutboundResponse` now tracks a running option offset
across the batch, and `lastPresentedOptions` flattens every option-bearing message from
the last batch into one combined, order-preserving list for matching — see
`docs/domains/d2c.md` §115/§118 for the bug's discovery and live proof of the fix. Also
added: a `TEXT` message carrying `imageUrl` (e.g. a product photo at selection time,
`docs/domains/d2c.md` §115) is sent via `sendImage` with the text as caption, falling
back to plain `sendText` of the same caption if the image send fails.

## 9. Known Limitations

- **Webhook signature verification is conditionally disabled.** `WHATSAPP_APP_SECRET`
  (a DIFFERENT credential from `WHATSAPP_TOKEN` — Meta signs webhooks with the App
  Secret, never the access token) is not currently set in this deployment's `.env`.
  When unset, `verifySignature` logs a loud warning on every delivery and proceeds
  unverified, rather than rejecting all webhook traffic. Setting `WHATSAPP_APP_SECRET`
  closes this gap with no code change.
- **BUTTONS/LIST render as numbered plain text**, not real WhatsApp interactive
  messages — see §8. Proven sufficient for this sprint's "does the full round trip
  work" bar; a real interactive-message upgrade is a natural next step.
- **One shared WhatsApp Business phone number across all tenants** — see §7. A real
  per-tenant WhatsApp Business Account provisioning flow is out of scope.
- **The local dev webhook is not publicly reachable from Meta's servers** — the
  `GET`/`POST` handshake and inbound-message/status-update handling were verified with
  real, correctly-shaped payloads sent directly to the local endpoint (the same
  "Webhook — Local Development" limitation `docs/domains/d2c.md` already documents for
  OPay).
- **This WhatsApp Business app is in Meta's development mode** — messages can only be
  delivered to phone numbers explicitly added as test recipients in the Meta App
  Dashboard. Confirmed live (see the completion report's Live Verification section):
  the FIRST real send attempt was correctly rejected by Meta itself (code 131030,
  "recipient not in the allowed list"), not a defect in this integration — a
  subsequent send to an allow-listed number succeeded with a real WAMID.

## 10. Configuration Reference

| Key                                                          | Required when                        | Notes                                           |
| ------------------------------------------------------------ | ------------------------------------ | ----------------------------------------------- |
| `WHATSAPP_PROVIDER_MODE`                                     | always has a default (`local`)       | `meta` to send real traffic                     |
| `WHATSAPP_TOKEN`                                             | `meta` mode                          | preferred over `WHATSAPP_ACCESS_TOKEN`          |
| `WHATSAPP_PHONE_NUMBER_ID`                                   | `meta` mode                          | unchanged from Sprint 29                        |
| `WHATSAPP_GRAPH_API_VERSION` / `WHATSAPP_GRAPH_API_BASE_URL` | `meta` mode                          | preferred over `WHATSAPP_API_BASE_URL`          |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN`                              | a real webhook is configured in Meta | `GET` handshake only                            |
| `WHATSAPP_APP_SECRET`                                        | —                                    | optional; enables `POST` signature verification |
| `WHATSAPP_DEFAULT_ORGANISATION_ID`                           | —                                    | optional; see §7                                |

See `docs/sprint-40.5-completion-report.md` for live verification evidence.
