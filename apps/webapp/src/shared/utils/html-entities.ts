// Reverses gateway/src/infra/sanitize.ts's escapeHtml, applied to chat SSE
// text before it reaches us. Safe to decode here: this app renders message
// text as plain React text nodes (never dangerouslySetInnerHTML), so React
// re-escapes anything dangerous on render regardless of what this returns —
// decoding just undoes the gateway's transport-level escaping so entities
// don't show up literally (e.g. "It&#39;s" instead of "It's").
const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
};

export function decodeHtmlEntities(text: string): string {
  return text.replace(/&amp;|&lt;|&gt;|&quot;|&#39;/g, (m) => ENTITIES[m]);
}
