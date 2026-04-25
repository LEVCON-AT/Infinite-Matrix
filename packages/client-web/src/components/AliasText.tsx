// String-Renderer mit Alias-Chip-Erkennung. Fuer Kontexte ohne Markdown
// (z.B. Checklisten-Item-Text). Wo Markdown erlaubt ist, nutzt man
// MarkdownLightView — der Parser dort erkennt Alias-Tokens ebenfalls.

import { For, type Component } from 'solid-js';
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
        return <AliasChip alias={t.alias} workspaceId={p.workspaceId} />;
      }}
    </For>
  );
};

export default AliasText;
