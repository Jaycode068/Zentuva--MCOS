import { z } from 'zod';

/**
 * Sprint 40.5 — Real Meta WhatsApp Cloud API Foundation (docs/domains/whatsapp.md).
 * The admin-only test-send surface's own request schemas
 * (`POST /api/whatsapp/test/{text,template,image}`) — deliberately separate from
 * `d2c.ts`'s `sendConversationMessageSchema` (that one drives the simulated/internal
 * Conversation Tester; this one sends a REAL outbound WhatsApp message through
 * whichever provider `WHATSAPP_PROVIDER_MODE` currently selects).
 */

/** A WhatsApp recipient — already-normalized E.164 is preferred, but this is the raw
 *  admin-entered value; `normalizePhoneNumber` runs server-side exactly like every
 *  other WhatsApp send path in this codebase, never trusted as pre-normalized here. */
const whatsAppRecipientSchema = z
  .string()
  .trim()
  .min(8, 'Recipient phone number is required')
  .max(20);

export const sendWhatsAppTestTextSchema = z.object({
  to: whatsAppRecipientSchema,
  text: z.string().trim().min(1, 'Message text is required').max(4096),
});
export type SendWhatsAppTestTextInput = z.infer<typeof sendWhatsAppTestTextSchema>;

/** `bodyParameters` is a plain ordered array mapping directly onto Meta's positional
 *  `{{1}}..{{n}}` placeholders — the brief's own already-manually-verified
 *  `jaspers_market_order_confirmation_v1` shape (3 parameters), kept generic rather than
 *  hardcoded to that one template name. */
export const sendWhatsAppTestTemplateSchema = z.object({
  to: whatsAppRecipientSchema,
  templateName: z.string().trim().min(1, 'Template name is required').max(200),
  languageCode: z.string().trim().min(1, 'Language code is required').max(20),
  bodyParameters: z.array(z.string().trim().max(500)).max(10).default([]),
});
export type SendWhatsAppTestTemplateInput = z.infer<typeof sendWhatsAppTestTemplateSchema>;

/** `imageUrl` must already be a public URL — this sprint builds no media storage/upload
 *  path (brief "Images must use public URLs. Do not create media storage this sprint."). */
export const sendWhatsAppTestImageSchema = z.object({
  to: whatsAppRecipientSchema,
  imageUrl: z.string().trim().url('imageUrl must be a valid public URL'),
  caption: z.string().trim().max(1024).optional(),
});
export type SendWhatsAppTestImageInput = z.infer<typeof sendWhatsAppTestImageSchema>;
