'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Badge, Button, Input, Label, Select, Textarea } from '@zentuva/ui';

import { D2cTabs } from '@/components/app/d2c-tabs';
import { ApiError } from '@/lib/api-client';

import { sendWhatsAppTestImage, sendWhatsAppTestTemplate, sendWhatsAppTestText } from './api';

type MessageType = 'TEXT' | 'TEMPLATE' | 'IMAGE';

/**
 * Sprint 40.5 — Real Meta WhatsApp Cloud API Foundation (docs/domains/whatsapp.md
 * "Admin Test Surface"). Admin-only screen to prove the real Meta Cloud API
 * integration — sends through whichever provider `WHATSAPP_PROVIDER_MODE` currently
 * selects (`local` in dev, `meta` to prove a real send). Template defaults are the
 * brief's own already-manually-verified `jaspers_market_order_confirmation_v1`
 * example. Extends the existing `/settings/d2c` admin shell, same tab-bar convention
 * as every other D2C settings page.
 */
export default function WhatsAppTestPage() {
  const [messageType, setMessageType] = useState<MessageType>('TEXT');
  const [to, setTo] = useState('');
  const [text, setText] = useState('Hello from Zentuva');
  const [templateName, setTemplateName] = useState('jaspers_market_order_confirmation_v1');
  const [languageCode, setLanguageCode] = useState('en_US');
  const [customerName, setCustomerName] = useState('John Doe');
  const [orderNumber, setOrderNumber] = useState('123456');
  const [orderDate, setOrderDate] = useState('Oct 6, 2026');
  const [imageUrl, setImageUrl] = useState('');
  const [caption, setCaption] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => {
      if (messageType === 'TEXT') {
        return sendWhatsAppTestText({ to, text });
      }
      if (messageType === 'TEMPLATE') {
        return sendWhatsAppTestTemplate({
          to,
          templateName,
          languageCode,
          bodyParameters: [customerName, orderNumber, orderDate],
        });
      }
      return sendWhatsAppTestImage({ to, imageUrl, caption: caption || undefined });
    },
    onError: (error) =>
      setFormError(error instanceof ApiError ? error.message : 'Failed to send message.'),
  });

  function handleSend() {
    setFormError(null);
    mutation.mutate();
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">WhatsApp Test</h1>
        <p className="text-sm text-muted-foreground">
          Send a real message through the configured WhatsApp provider — proves the Meta Cloud API
          integration end-to-end. Never exposes the access token or verify token.
        </p>
      </div>

      <D2cTabs />

      <div className="max-w-lg space-y-4 rounded-lg border border-border p-4">
        <div className="space-y-1.5">
          <Label>Recipient Phone</Label>
          <Input placeholder="+2348012345678" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>

        <div className="space-y-1.5">
          <Label>Message Type</Label>
          <Select
            value={messageType}
            onChange={(e) => setMessageType(e.target.value as MessageType)}
          >
            <option value="TEXT">Text</option>
            <option value="TEMPLATE">Template</option>
            <option value="IMAGE">Image</option>
          </Select>
        </div>

        {messageType === 'TEXT' && (
          <div className="space-y-1.5">
            <Label>Message</Label>
            <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} />
          </div>
        )}

        {messageType === 'TEMPLATE' && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Template Name</Label>
              <Input value={templateName} onChange={(e) => setTemplateName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Language Code</Label>
              <Input value={languageCode} onChange={(e) => setLanguageCode(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Customer Name (body param 1)</Label>
              <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Order Number (body param 2)</Label>
              <Input value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Order Date (body param 3)</Label>
              <Input value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
            </div>
          </div>
        )}

        {messageType === 'IMAGE' && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Image URL (must be public)</Label>
              <Input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Caption (optional)</Label>
              <Input value={caption} onChange={(e) => setCaption(e.target.value)} />
            </div>
          </div>
        )}

        {formError && <p className="text-sm text-destructive">{formError}</p>}

        {mutation.data && (
          <div className="rounded-md border border-border p-3 text-sm">
            <Badge variant={mutation.data.success ? 'success' : 'warning'}>
              {mutation.data.success ? 'Sent' : 'Failed'}
            </Badge>
            {mutation.data.metaMessageId && (
              <p className="mt-2 text-muted-foreground">
                Message id: {mutation.data.metaMessageId}
              </p>
            )}
            {mutation.data.errorCode && (
              <p className="mt-2 text-destructive">{mutation.data.errorCode}</p>
            )}
          </div>
        )}

        <Button onClick={handleSend} disabled={mutation.isPending || !to}>
          {mutation.isPending ? 'Sending…' : 'Send'}
        </Button>
      </div>
    </div>
  );
}
