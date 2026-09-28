'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Input } from '@zentuva/ui';

import { ApiError } from '@/lib/api-client';

import {
  listConversations,
  sendConversationMessage,
  type ConversationOption,
  type ConversationOutboundMessage,
} from './api';

interface LogEntry {
  from: 'ME' | 'BOT';
  message: ConversationOutboundMessage | { type: 'TEXT'; text: string };
}

/**
 * Sprint 33 — Consumer Conversation Experience Foundation
 * (docs/domains/d2c.md §"Internal Test Interface"). A deliberately small
 * internal harness for the conversation contract — NOT the Sprint 42
 * consumer-facing simulator. An internal tester picks a test phone number,
 * sends text or clicks the bot's own rendered buttons/list options, and
 * watches state transitions happen for real against the actual
 * `ConversationService`/`ConsumerService` (Sprint 32) — reused unchanged.
 */
export default function ConversationTestPage() {
  const [phone, setPhone] = useState('');
  const [activePhone, setActivePhone] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [textInput, setTextInput] = useState('');
  const [lastOptions, setLastOptions] = useState<ConversationOption[] | null>(null);
  const [state, setState] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: conversationsData } = useQuery({
    queryKey: ['d2c-conversations'],
    queryFn: () => listConversations(),
  });

  const send = useMutation({
    mutationFn: (input: Parameters<typeof sendConversationMessage>[1]) => {
      if (!activePhone) throw new Error('No active test conversation');
      return sendConversationMessage(activePhone, input);
    },
    onSuccess: (response) => {
      setLog((prev) => [
        ...prev,
        ...response.messages.map((m) => ({ from: 'BOT' as const, message: m })),
      ]);
      setState(response.state);
      const lastList = [...response.messages]
        .reverse()
        .find((m) => m.type === 'BUTTONS' || m.type === 'LIST');
      setLastOptions(lastList && 'options' in lastList ? lastList.options : null);
      queryClient.invalidateQueries({ queryKey: ['d2c-conversations'] });
    },
  });

  function startConversation() {
    if (!phone.trim()) return;
    setActivePhone(phone.trim());
    setLog([]);
    setLastOptions(null);
    setState(null);
    send.mutate({ type: 'TEXT', text: 'hi' });
  }

  function sendText() {
    if (!textInput.trim()) return;
    setLog((prev) => [...prev, { from: 'ME', message: { type: 'TEXT', text: textInput.trim() } }]);
    send.mutate({ type: 'TEXT', text: textInput.trim() });
    setTextInput('');
  }

  function clickOption(option: ConversationOption) {
    setLog((prev) => [...prev, { from: 'ME', message: { type: 'TEXT', text: option.label } }]);
    send.mutate({ type: 'LIST_SELECTION', value: option.value });
  }

  function reset() {
    setLog((prev) => [...prev, { from: 'ME', message: { type: 'TEXT', text: 'MENU' } }]);
    send.mutate({ type: 'BUTTON', value: 'MENU' });
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Conversation Tester</h1>
        <p className="text-sm text-muted-foreground">
          Internal test harness for the Sprint 33 conversation contract — not the future
          consumer-facing simulator. Exercises the real ConversationService/ConsumerService.
        </p>
      </div>

      {!activePhone ? (
        <div className="space-y-3 rounded-lg border border-border p-4">
          <label className="block text-sm font-medium">Test phone number</label>
          <div className="flex gap-2">
            <Input
              placeholder="08012345678"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            <Button onClick={startConversation} disabled={!phone.trim()}>
              Start
            </Button>
          </div>
          {conversationsData && conversationsData.items.length > 0 && (
            <div className="pt-2">
              <p className="mb-1 text-xs text-muted-foreground">Recent test conversations:</p>
              <div className="flex flex-wrap gap-2">
                {conversationsData.items.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setPhone(c.externalConversationId);
                      setActivePhone(c.externalConversationId);
                      setLog([]);
                      setLastOptions(null);
                      setState(c.state);
                    }}
                    className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted/50"
                  >
                    {c.externalConversationId} · {c.state}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border border-border px-4 py-2">
            <div className="text-sm">
              <span className="font-medium">{activePhone}</span>
              {state && (
                <Badge variant="default" className="ml-2">
                  {state}
                </Badge>
              )}
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={reset}>
                Reset (MENU)
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setActivePhone(null);
                  setLog([]);
                  setLastOptions(null);
                  setState(null);
                }}
              >
                Change Number
              </Button>
            </div>
          </div>

          <div className="h-96 space-y-2 overflow-y-auto rounded-lg border border-border p-4">
            {log.map((entry, i) => (
              <div key={i} className={entry.from === 'ME' ? 'text-right' : 'text-left'}>
                <div
                  className={`inline-block max-w-[80%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
                    entry.from === 'ME' ? 'bg-primary text-primary-foreground' : 'bg-muted'
                  }`}
                >
                  {entry.message.type === 'TEXT'
                    ? entry.message.text
                    : 'text' in entry.message
                      ? entry.message.text
                      : ''}
                </div>
              </div>
            ))}
            {send.isPending && <p className="text-xs text-muted-foreground">…</p>}
            {send.isError && (
              <p className="text-xs text-destructive">
                {send.error instanceof ApiError ? send.error.message : 'Failed to send message.'}
              </p>
            )}
          </div>

          {lastOptions && lastOptions.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {lastOptions.map((option) => (
                <Button
                  key={option.value}
                  size="sm"
                  variant="outline"
                  onClick={() => clickOption(option)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <Input
              placeholder="Type a message…"
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendText()}
            />
            <Button onClick={sendText} disabled={!textInput.trim() || send.isPending}>
              Send
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
