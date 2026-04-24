// Zell-Dokumentation als eigene Seite. Aufruf ueber
// /w/:wsId/c/:cellId/docs — Einstieg aus der Matrix-Ansicht ueber
// die derived Doku-Pill (MatrixView ¶-Chip).
//
// Warum separat statt nur CellInfoPage mit Doku-Sektion:
// wenn die Zelle nur Docs haelt (kein Info-Feature), war der
// Page-Header "Info" irrefuehrend. Mit der eigenen Docs-Page
// passt das Label zum Inhalt.
//
// Die bestehende CellDocsSection wird wiederverwendet — ueberall
// dort, wo Docs angezeigt werden, sehen sie gleich aus.

import { Show, type Component } from 'solid-js';
import type { CellRow, ColRow, RowRow } from '../lib/types';
import CellDocsSection from './CellDocsSection';
import { openDocsPopup } from '../lib/docs-ui';
import { useNavigate } from '@solidjs/router';

type Props = {
  workspaceId: string;
  cell: CellRow;
  row: RowRow | undefined;
  col: ColRow | undefined;
  realtimeDocsVersion: number;
};

const CellDocsPage: Component<Props> = (p) => {
  const navigate = useNavigate();
  const breadcrumb = () => {
    const r = p.row?.label || '(Zeile)';
    const c = p.col?.label || '(Spalte)';
    return `${r} × ${c}`;
  };
  const matrixHref = () => `/w/${p.workspaceId}/n/${p.cell.matrix_id}`;

  return (
    <div class="cell-docs-page">
      <header class="cell-page-head">
        <div class="cell-page-head-text">
          <h3>Dokumentation</h3>
          <a
            class="cell-page-sub cell-page-sub-link"
            href={matrixHref()}
            onClick={(e) => {
              e.preventDefault();
              navigate(matrixHref());
            }}
            title="Zur Matrix"
          >
            {breadcrumb()}
          </a>
          <Show when={p.cell.alias}>
            <span class="node-alias">^{p.cell.alias}</span>
          </Show>
        </div>
        <button
          type="button"
          class="btn-subtle cell-page-doc-btn"
          onClick={() =>
            openDocsPopup({
              sourceAlias: p.cell.alias ?? null,
              attachedCellId: p.cell.id,
            })
          }
          title="Neue Doku fuer diese Zelle"
        >
          + In Doku erfassen
        </button>
      </header>

      <CellDocsSection
        cell={p.cell}
        workspaceId={p.workspaceId}
        realtimeVersion={p.realtimeDocsVersion}
      />
    </div>
  );
};

export default CellDocsPage;
