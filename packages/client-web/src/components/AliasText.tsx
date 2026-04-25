// String-Renderer mit Alias-Chip-Erkennung. Fuer Kontexte ohne Markdown
// (z.B. Checklisten-Item-Text). Wo Markdown erlaubt ist, nutzt man
// MarkdownLightView — der Parser dort erkennt Alias-Tokens ebenfalls.

import { For, type Component } from 'solid-js';
import { ALIAS_REF_RE } from '../lib/alias';
import AliasChip from './AliasChip';

type Props = {
  text: string;
  workspaceId: string;
};

type Token = { kind: 'text'; value: string } | { kind: 'alias'; alias: string };

function tokenize(text: string): Token[] {
  const out: Token[] = [];
  let last = 0;
  ALIAS_REF_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ALIAS_REF_RE.exec(text)) !== null) {
    if (m.index > last) out.push({ kind: 'text', value: text.slice(last, m.index) });
    out.push({ kind: 'alias', alias: m[1].toLowerCase() });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ kind: 'text', value: text.slice(last) });
  return out;
}

const AliasText: Component<Props> = (p) => {
  return (
    <For each={tokenize(p.text)}>
      {(t) => {
        if (t.kind === 'text') return <>{t.value}</>;
        return <AliasChip alias={t.alias} workspaceId={p.workspaceId} />;
      }}
    </For>
  );
};

export default AliasText;
