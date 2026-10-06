import {
  SendWhatsAppTestImageInput,
  SendWhatsAppTestTemplateInput,
  SendWhatsAppTestTextInput,
} from '@zentuva/validation';

import { apiFetch } from '@/lib/api-client';

/**
 * Sprint 40.5 — Real Meta WhatsApp Cloud API Foundation (docs/domains/whatsapp.md).
 * API client for the admin-only WhatsApp test screen — these hit
 * `POST /api/whatsapp/test/{text,template,image}`, which always sends through whichever
 * real/local provider `WHATSAPP_PROVIDER_MODE` currently selects.
 */

export interface WhatsAppTestSendResult {
  success: boolean;
  metaMessageId?: string;
  errorCode?: string;
}

export function sendWhatsAppTestText(
  input: SendWhatsAppTestTextInput,
): Promise<WhatsAppTestSendResult> {
  return apiFetch<WhatsAppTestSendResult>('/whatsapp/test/text', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function sendWhatsAppTestTemplate(
  input: SendWhatsAppTestTemplateInput,
): Promise<WhatsAppTestSendResult> {
  return apiFetch<WhatsAppTestSendResult>('/whatsapp/test/template', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function sendWhatsAppTestImage(
  input: SendWhatsAppTestImageInput,
): Promise<WhatsAppTestSendResult> {
  return apiFetch<WhatsAppTestSendResult>('/whatsapp/test/image', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
