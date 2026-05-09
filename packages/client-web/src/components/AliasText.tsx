// String-Renderer mit Alias-Chip + URL-Link-Erkennung. Fuer Kontexte
// ohne Markdown (z.B. Checklisten-Item-Text, info_field-Values). Wo
// Markdown erlaubt ist, nutzt man MarkdownLightView — der Parser dort
// erkennt Alias-Tokens ebenfalls (URL-Erkennung via Markdown-Syntax).
//
// §14.7 (User 2026-05-07): „In einem Infofeld URL kann ich auch einfach
// ein alias eintippen als direktverlinkung." Der Tokenizer liefert
// `kind:'url'` fuer http(s)://, mailto:, tel:-Pattern (sanitized via
// sanitizeUrl) und `kind:'alias'` fuer ^kuerzel. Beide werden als
// klickbare Targets gerendert.

import { type Component, For } from 'solid-js';
import { tokenizeAliasText } from '../lib/alias-tokenizer';
import AliasChip from './AliasChip';

type Props = {
  text: string;
  workspaceId: string;
};

const AliasText: Component<Props> = (p) => {
  return (
    <For each={tokenizeAliasText(p.text)}>
      {(t) => {
        if (t.kind === 'text') return <>{t.value}</>;
        if (t.kind === 'alias') {
          return <AliasChip alias={t.alias} workspaceId={p.workspaceId} />;
        }
        // URL-Token: noopener+noreferrer fuer XSS-/Tab-Hijack-Defense.
        // sanitizeUrl wurde bereits im Tokenizer geprueft, der Wert
        // hier ist garantiert https/http/mailto/tel.
        return (
          <a
            class="alias-text-link"
            href={t.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
          >
            {t.url}
          </a>
        );
      }}
    </For>
  );
};

export default AliasText;
