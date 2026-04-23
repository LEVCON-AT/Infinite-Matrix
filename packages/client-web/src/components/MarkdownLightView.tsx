// Gemeinsame Render-Komponente fuer Markdown-Light-Content.
// Aus NodeDescription extrahiert, damit DocsPopup & co den gleichen
// Parser- und Render-Pfad nutzen (bold/italic/code/http-Auto-Link,
// Paragraphen nach Leerzeile, Line-Breaks innerhalb Paragraph).

import { For, type Component } from 'solid-js';
import {
  parseMarkdownLight,
  type MdInline,
  type MdParagraph,
} from '../lib/markdown-lite';
import AliasChip from './AliasChip';

const RenderInline: Component<{ nodes: MdInline[]; workspaceId?: string }> = (p) => {
  return (
    <For each={p.nodes}>
      {(n) => {
        if (n.type === 'text') return <>{n.value}</>;
        if (n.type === 'bold')
          return (
            <strong>
              <RenderInline nodes={n.children} workspaceId={p.workspaceId} />
            </strong>
          );
        if (n.type === 'italic')
          return (
            <em>
              <RenderInline nodes={n.children} workspaceId={p.workspaceId} />
            </em>
          );
        if (n.type === 'code') return <code class="md-code">{n.value}</code>;
        if (n.type === 'link')
          return (
            <a
              href={n.href}
              target="_blank"
              rel="noopener noreferrer"
              class="md-link"
            >
              {n.label}
            </a>
          );
        if (n.type === 'alias') {
          // Ohne workspaceId koennen wir weder aufloesen noch menu oeffnen —
          // fallback auf Plain-Text mit `^`-Prefix.
          if (!p.workspaceId) return <>^{n.alias}</>;
          return <AliasChip alias={n.alias} workspaceId={p.workspaceId} />;
        }
        return null;
      }}
    </For>
  );
};

const RenderParagraphs: Component<{
  paragraphs: MdParagraph[];
  workspaceId?: string;
}> = (p) => {
  return (
    <For each={p.paragraphs}>
      {(para) => (
        <p>
          <For each={para.lines}>
            {(line, i) => (
              <>
                {i() > 0 && <br />}
                <RenderInline nodes={line} workspaceId={p.workspaceId} />
              </>
            )}
          </For>
        </p>
      )}
    </For>
  );
};

type Props = {
  text: string;
  // Optional: wenn gesetzt, werden `^alias`-Tokens als interaktive Chips
  // gerendert (Click = dispatch, Rechtsklick = Context-Menu). Ohne wsId
  // fallen Aliases auf Plain-Text zurueck.
  workspaceId?: string;
};

// Markdown-Light-Rendering als Top-Level-Component. Nimmt den Rohtext,
// parsed pro Render (leichtgewichtig; Memoization im Caller wenn noetig).
const MarkdownLightView: Component<Props> = (p) => {
  return (
    <RenderParagraphs
      paragraphs={parseMarkdownLight(p.text)}
      workspaceId={p.workspaceId}
    />
  );
};

export default MarkdownLightView;
