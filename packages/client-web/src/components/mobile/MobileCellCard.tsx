// MobileCellCard — Reichhaltige Cell-Karte fuer den Snap-Karusell-Modus
// auf Phone. Etwa 85vw breit, 140px hoch (rem-skaliert). Layout:
//   - Top:    Cell-Name (Row-Label, fallback auf 'Leer')
//   - Mid:    Smart-Summary (overdue / today / active mit •-Separator)
//   - Bottom: Feature-Chips als 44x44 Touch-Targets
//
// Tap auf Hintergrund:
//   - Edit-Mode → onCardTap (oeffnet NewCellWizard via MatrixView)
//   - View-Mode → onCardEnter (Phase 3 O.8.G: Matrix-Vorrang / 1 nav / Picker)
// Tap auf Feature-Chip → onChipClick (gleicher Handler wie Desktop).

import { type Component, For, Show } from 'solid-js';
import type { CellFeature } from '../../lib/types';
import type { CellRow, ColRow, RowRow } from '../../lib/types';
import type { CellTaskSummary as CellSummary } from '../../lib/task-aggregate';
import CellTaskSummary from '../CellTaskSummary';
import Icon from '../Icon';
import PresenceMini from '../PresenceMini';
import type { PresenceUser } from '../../lib/presence';
import { FEATURE_ICON, FEATURE_LABEL, FEATURE_ORDER } from '../MatrixView';

type MobileCellCardProps = {
  row: RowRow;
  col: ColRow;
  cell: CellRow | undefined;
  summary: CellSummary | undefined;
  hasDoc: boolean;
  presence: PresenceUser[];
  editMode: boolean;
  workspaceId: string;
  onChipClick: (e: MouseEvent, feat: CellFeature | 'doc') => void;
  onCardTap: () => void;
};

const MobileCellCard: Component<MobileCellCardProps> = (props) => {
  const features = (): CellFeature[] =>
    (props.cell?.features ?? []).filter((f): f is CellFeature =>
      (FEATURE_ORDER as string[]).includes(f),
    );

  const cardName = (): string => props.row.label || '—';

  return (
    <article
      class="mobile-cell-card"
      classList={{
        'mobile-cell-card-empty': !props.cell,
        'mobile-cell-card-edit': props.editMode,
      }}
      data-row-id={props.row.id}
      data-col-id={props.col.id}
      role="button"
      tabIndex={0}
      onClick={props.onCardTap}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          props.onCardTap();
        }
      }}
    >
      <header class="mobile-cell-card-head">
        <PresenceMini users={props.presence} />
        <span class="mobile-cell-card-title">{cardName()}</span>
        <Show when={props.cell?.alias}>
          {(alias) => <span class="mobile-cell-card-alias">^{alias()}</span>}
        </Show>
      </header>

      <Show when={props.summary}>
        {(s) => (
          <div class="mobile-cell-card-summary">
            <CellTaskSummary
              workspaceId={props.workspaceId}
              cellId={props.cell?.id ?? ''}
              summary={s()}
            />
          </div>
        )}
      </Show>

      <Show
        when={features().length > 0 || props.hasDoc}
        fallback={
          <Show when={!props.cell}>
            <div class="mobile-cell-card-hint">
              {props.editMode ? 'Tippen zum Anlegen' : 'Leer'}
            </div>
          </Show>
        }
      >
        <footer class="mobile-cell-card-feats">
          <For each={features()}>
            {(f) => (
              <button
                type="button"
                class="mobile-cell-card-chip click-pulse"
                data-feat={f}
                aria-label={`${FEATURE_LABEL[f]} oeffnen`}
                onClick={(e) => {
                  e.stopPropagation();
                  props.onChipClick(e, f);
                }}
              >
                <Icon name={FEATURE_ICON[f]} size={20} />
              </button>
            )}
          </For>
          <Show when={props.hasDoc}>
            <button
              type="button"
              class="mobile-cell-card-chip click-pulse"
              data-feat="doc"
              aria-label="Dokumentation oeffnen"
              onClick={(e) => {
                e.stopPropagation();
                props.onChipClick(e, 'doc');
              }}
            >
              <Icon name="document-text" size={20} />
            </button>
          </Show>
        </footer>
      </Show>
    </article>
  );
};

export default MobileCellCard;
