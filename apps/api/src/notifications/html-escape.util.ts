/**
 * Sprint 28 §6.3 "Rendering Safety." `Notification.body` may embed user-authored
 * free text (a reject/return comment, Sprint 26.1) — safe to interpolate into a
 * PLAIN-TEXT email body as-is, but MUST be escaped before going into the HTML
 * variant. The five characters HTML actually needs escaped, nothing more.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
