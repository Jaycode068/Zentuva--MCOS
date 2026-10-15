import { isWithinMessagingWindow, MESSAGING_WINDOW_MS } from './whatsapp-messaging-window';

describe('isWithinMessagingWindow', () => {
  const now = new Date('2026-10-15T12:00:00.000Z');

  it('returns true when the last inbound message was just now', () => {
    expect(isWithinMessagingWindow(now, now)).toBe(true);
  });

  it('returns true when the last inbound message was 1 hour ago', () => {
    const lastInboundAt = new Date(now.getTime() - 60 * 60 * 1000);
    expect(isWithinMessagingWindow(lastInboundAt, now)).toBe(true);
  });

  it('returns true exactly at the 24h boundary', () => {
    const lastInboundAt = new Date(now.getTime() - MESSAGING_WINDOW_MS);
    expect(isWithinMessagingWindow(lastInboundAt, now)).toBe(true);
  });

  it('returns false just past the 24h boundary', () => {
    const lastInboundAt = new Date(now.getTime() - MESSAGING_WINDOW_MS - 1);
    expect(isWithinMessagingWindow(lastInboundAt, now)).toBe(false);
  });

  it('returns false when the last inbound message was 25 hours ago', () => {
    const lastInboundAt = new Date(now.getTime() - 25 * 60 * 60 * 1000);
    expect(isWithinMessagingWindow(lastInboundAt, now)).toBe(false);
  });

  it('returns false (fails safe) when no inbound message has ever been recorded', () => {
    expect(isWithinMessagingWindow(null, now)).toBe(false);
  });
});
