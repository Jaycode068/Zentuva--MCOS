'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@zentuva/ui';

import { D2cTabs } from '@/components/app/d2c-tabs';
import { CommunicationHistoryList } from '@/components/app/d2c-communication-history';
import { ApiError } from '@/lib/api-client';

import { listCommunicationsForConversation } from '../api';
import { getConversation, listConversations, type ConversationMessage } from '../conversation/api';

/**
 * Sprint 43.5 — D2C Two-Way Conversation Reliability (docs/domains/d2c.md
 * "Conversation Traceability," brief §Phase 14 "Conversation Transcript / Debug
 * View"). A READ-ONLY operational tool for an operator to answer "what did this
 * consumer send, what did Zentuva reply, what state was the conversation in, and did
 * the real WhatsApp send succeed" — distinct from "Conversation Tester" (which
 * actively drives the real `ConversationService` for testing). Adds no new backend
 * state: the transcript comes from the EXISTING `GET /d2c/conversations/:id`
 * (Sprint 33), the delivery log from the EXISTING `ConsumerWhatsAppDelivery` table
 * (Sprint 43, widened this sprint to also cover conversation replies) via
 * `GET /d2c/communications/by-conversation/:id` — never a duplicated/parallel history
 * mechanism.
 */
export default function D2CConversationsPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: ['d2c-conversations-list'],
    queryFn: () => listConversations(),
  });

  const detailQuery = useQuery({
    queryKey: ['d2c-conversation-detail', selectedId],
    queryFn: () => getConversation(selectedId!),
    enabled: !!selectedId,
  });

  const deliveriesQuery = useQuery({
    queryKey: ['d2c-conversation-deliveries', selectedId],
    queryFn: () => listCommunicationsForConversation(selectedId!),
    enabled: !!selectedId,
  });

  const conversations = listQuery.data?.items ?? [];

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">D2C Operations</h1>
        <p className="text-sm text-muted-foreground">
          Inspect any consumer conversation&apos;s real transcript, conversation state, and real
          WhatsApp delivery log — an internal operational/debugging tool, never a marketing
          messaging history.
        </p>
      </div>

      <D2cTabs />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section className="rounded-lg border border-border lg:col-span-1">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold">Conversations</h2>
          </div>
          {listQuery.isLoading && (
            <p className="px-4 py-6 text-sm text-muted-foreground">Loading…</p>
          )}
          {listQuery.isError && (
            <p className="px-4 py-6 text-sm text-destructive">
              {listQuery.error instanceof ApiError
                ? listQuery.error.message
                : 'Failed to load conversations.'}
            </p>
          )}
          {!listQuery.isLoading && conversations.length === 0 && (
            <p className="px-4 py-6 text-sm text-muted-foreground">No conversations yet.</p>
          )}
          <ul className="max-h-[32rem] divide-y divide-border overflow-y-auto">
            {conversations.map((conversation) => (
              <li key={conversation.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(conversation.id)}
                  className={`w-full px-4 py-3 text-left text-sm hover:bg-muted/50 ${
                    selectedId === conversation.id ? 'bg-muted/50' : ''
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{conversation.externalConversationId}</span>
                    <Badge variant="default">{conversation.state}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Last active {new Date(conversation.lastInteractionAt).toLocaleString()}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="space-y-6 lg:col-span-2">
          {!selectedId && (
            <div className="rounded-lg border border-border px-4 py-10 text-center text-sm text-muted-foreground">
              Select a conversation to view its transcript.
            </div>
          )}

          {selectedId && detailQuery.isLoading && (
            <p className="text-sm text-muted-foreground">Loading transcript…</p>
          )}
          {selectedId && detailQuery.isError && (
            <p className="text-sm text-destructive">
              {detailQuery.error instanceof ApiError
                ? detailQuery.error.message
                : 'Failed to load this conversation.'}
            </p>
          )}

          {selectedId && detailQuery.data && (
            <div className="rounded-lg border border-border">
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <div>
                  <h2 className="text-sm font-semibold">
                    {detailQuery.data.conversation.externalConversationId}
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    {detailQuery.data.conversation.consumerId
                      ? `Consumer: ${detailQuery.data.conversation.consumerId}`
                      : 'No Consumer linked yet'}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Badge variant="default">{detailQuery.data.conversation.state}</Badge>
                  <Badge variant="default">{detailQuery.data.conversation.status}</Badge>
                </div>
              </div>
              <ul className="max-h-[36rem] space-y-3 overflow-y-auto p-4">
                {detailQuery.data.messages.map((message) => (
                  <TranscriptRow key={message.id} message={message} />
                ))}
                {detailQuery.data.messages.length === 0 && (
                  <li className="text-sm text-muted-foreground">No messages yet.</li>
                )}
              </ul>
            </div>
          )}

          {selectedId && (
            <div className="rounded-lg border border-border">
              <div className="border-b border-border px-4 py-3">
                <h2 className="text-sm font-semibold">WhatsApp Delivery Log</h2>
                <p className="text-xs text-muted-foreground">
                  Every real outbound WhatsApp send for this conversation — provider, WAMID, status,
                  and (if it failed) why.
                </p>
              </div>
              <div className="p-4">
                {deliveriesQuery.isLoading && (
                  <p className="text-sm text-muted-foreground">Loading…</p>
                )}
                {deliveriesQuery.data && (
                  <CommunicationHistoryList
                    items={deliveriesQuery.data.items}
                    queryKeyToInvalidate={['d2c-conversation-deliveries', selectedId]}
                  />
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/** One transcript turn — `payload` is the internal `ConversationInput`
 *  (`CONSUMER`/INBOUND) or `ConversationOutboundMessage[]` (`ZENTUVA`/OUTBOUND) shape
 *  `ConversationService` itself works with, rendered as plain text for an operator;
 *  never re-interpreted as anything channel-specific here. */
function TranscriptRow({ message }: { message: ConversationMessage }) {
  const isInbound = message.direction === 'INBOUND';
  return (
    <li className={isInbound ? 'text-left' : 'text-right'}>
      <p className="text-xs font-medium text-muted-foreground">
        {isInbound ? 'CONSUMER' : 'ZENTUVA'} · {new Date(message.createdAt).toLocaleTimeString()}
        {message.externalMessageId ? ` · ${message.externalMessageId}` : ''}
      </p>
      <div
        className={`mt-1 inline-block max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
          isInbound ? 'bg-muted' : 'bg-primary/10'
        }`}
      >
        {renderPayload(message.payload)}
      </div>
    </li>
  );
}

function renderPayload(payload: unknown): string {
  if (!payload) return '';
  if (Array.isArray(payload)) {
    return payload
      .map((part) => (typeof part === 'object' && part && 'text' in part ? String(part.text) : ''))
      .filter(Boolean)
      .join('\n\n');
  }
  if (typeof payload === 'object' && payload) {
    if ('text' in payload) return String((payload as { text: unknown }).text);
    if ('value' in payload) return String((payload as { value: unknown }).value);
  }
  return JSON.stringify(payload);
}
