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

const RenderInline: Component<{ nodes: MdInline[] }> = (p) => {
  return (
    <For each={p.nodes}>
      {(n) => {
        if (n.type === 'text') return <>{n.value}</>;
        if (n.type === 'bold')
          return (
            <strong>
              <RenderInline nodes={n.children} />
            </strong>
          );
        if (n.type === 'italic')
          return (
            <em>
              <RenderInline nodes={n.children} />
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
        return null;
      }}
    </For>
  );
};

const RenderParagraphs: Component<{ paragraphs: MdParagraph[] }> = (p) => {
  return (
    <For each={p.paragraphs}>
      {(para) => (
        <p>
          <For each={para.lines}>
            {(line, i) => (
              <>
                {i() > 0 && <br />}
                <RenderInline nodes={line} />
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
};

// Markdown-Light-Rendering als Top-Level-Component. Nimmt den Rohtext,
// parsed pro Render (leichtgewichtig; Memoization im Caller wenn noetig).
const MarkdownLightView: Component<Props> = (p) => {
  return <RenderParagraphs paragraphs={parseMarkdownLight(p.text)} />;
};

export default MarkdownLightView;
