// Welle D — HTML-Sanitize-Wrapper.
//
// dompurify mit konservativer Allowlist. Wir geben ProseMirror's
// HTML-Output durch, der ist bereits schema-konstrained, aber dompurify
// schuetzt zusaetzlich gegen kompromittierte Server-Daten + zukuenftige
// Schema-Erweiterungen.
//
// Allowlist:
//   - Nodes: paragraph, heading[1-3], blockquote, code_block (pre/code),
//             bullet/orderedList, listItem.
//   - Marks: bold (strong/b), italic (em/i), code, link (a-href).
//   - Mention-Nodes (V2 D.8): span[data-mention-*] — kommt mit dem
//     Mention-Plugin dazu, ist hier schon vorbereitet.

import DOMPurify from 'dompurify';

const ALLOWED_TAGS = [
  'p',
  'h1',
  'h2',
  'h3',
  'blockquote',
  'pre',
  'code',
  'ul',
  'ol',
  'li',
  'strong',
  'em',
  'b',
  'i',
  'a',
  'br',
  'span',
];

const ALLOWED_ATTR = [
  'href',
  'title',
  // ProseMirror-Schema-Default
  'class',
  // Mention-Plugin (D.8): data-mention-trigger / -ref-kind / -ref-id /
  // -value. dompurify-Default erlaubt data-* nicht — explizit listen.
  'data-mention-trigger',
  'data-mention-ref-kind',
  'data-mention-ref-id',
  'data-mention-value',
];

export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html ?? '', {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    // Externe Links bekommen rel=noopener via Hook unten. KEEP_CONTENT
    // sorgt dafuer dass blockierte Tags zumindest ihren Text behalten.
    KEEP_CONTENT: true,
  });
}

// rel=noopener fuer alle <a target=_blank>-Links setzen (XSS-Schutz +
// reverse-tabnabbing).
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A' && node.hasAttribute('href')) {
    const href = node.getAttribute('href') ?? '';
    if (/^https?:\/\//i.test(href)) {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    } else if (href.startsWith('javascript:')) {
      node.removeAttribute('href');
    }
  }
});
