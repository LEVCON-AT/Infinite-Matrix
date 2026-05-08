// WV.WV.5 — Widget-Slot-Picker Helper-Library.
//
// Generischer Picker fuer „in welchem Widget-Slot soll dieses Atom
// landen?"-Entscheidungen. Verbindlich verankert im Konzept §9.10b
// (WidgetPicker als Generalisierung des KanbanColPicker) + §9.A.6
// (Multi-Root-Widget-Disambiguierung).
//
// Pre-Welle-A-Foundation: die `template_widgets`-Tabelle existiert
// noch nicht — die Komponente wird in Welle A aktiv genutzt, wenn
// Vorlagen-Drops in Cells routen muessen. Heute wird sie als Anchor
// + Type-Vertrag etabliert, damit Welle-A-Caller direkt konsumieren.
//
// Routing-Logik (§9.A.6):
//   0 kompatible Slots          → action='create-template'
//                                 (Caller zeigt Confirm-Modal
//                                 „Neue Vorlage anlegen?")
//   1 kompatibler Slot          → action='direct' (auto-route)
//   ≥2 mit genau 1 Root-Widget  → action='direct' auf das Root
//                                 (Konvention: Root hat Vorrang)
//   ≥2 mit ≥2 Root-Widgets      → action='picker' (Root prominent)
//   ≥2 ohne Root-Widget         → action='picker' (alle gleichrangig)
//
// Force-Mode (Modifier-Key, z.B. Shift+Drop): action='picker' immer
// wenn ≥1 Slot — User kann auto-Routing umgehen.
//
// Reuse-Vertrag fuer Caller (Welle A):
//   - BoardView/ChecklistPanel/CalendarFeature drop-handler ruft
//     `chooseWidgetSlot(slots, { force })` mit den fuer den Cell
//     errechneten kompatiblen Slots.
//   - Bei action='direct' ruft der Caller direkt seine Insert-Logik
//     mit `slot.widgetId` als Ziel.
//   - Bei action='picker' rendert der Caller `<WidgetPicker />` mit
//     `slots` als Props und delegiert die Wahl.
//   - Bei action='create-template' rendert der Caller einen
//     Confirm-Dialog mit Vorlagen-Auswahl (Welle A — heute Stub).

// Widget-Type-Enum aus dem Konzept (§6.2 + §9.10b). V1 deckt die
// fuenf Foundation-Widgets ab; weitere kommen in Welle B/C/D dazu.
// String-Literals statt const-Object damit Welle-A-Schema ohne
// Type-Drift in `template_widgets.type` (text-Spalte) konsumiert.
export type WidgetType =
  | 'kanban'
  | 'checklist'
  | 'info'
  | 'doc'
  | 'link'
  | 'calendar'
  | 'smart_summary';

// Ein einzelner kompatibler Widget-Slot in einer Cell. Caller
// (BoardView/Welle-A-DropHandler) baut die Liste pro Cell aus
// `cell_template_instances` JOIN `template_widgets` JOIN
// `feature_templates`. Picker bleibt source-agnostisch.
export type WidgetSlotOption = {
  widgetId: string; // template_widgets.id
  widgetType: WidgetType; // template_widgets.type
  templateId: string; // feature_templates.id (Bezeichner-Anker)
  templateName: string; // feature_templates.label fuer UI
  // §6.2: feature_templates.root_widget_id zeigt auf den
  // primaeren Widget-Slot der Vorlage. Atom-Drop ohne Slot-Wahl
  // landet hier per Default. Picker sortiert Root-First, hebt
  // sie visuell ab.
  isRoot: boolean;
  // Optional: Section-Title aus template_sections.title — nur
  // angezeigt wenn die Vorlage > 1 Section hat (Caller-Entscheidung).
  sectionLabel?: string | null;
  // Frei-Label (z.B. „Spalte: Backlog" bei kanban). Caller bestimmt
  // — Picker rendert nur. Bei null wird `templateName` genutzt.
  slotLabel?: string | null;
};

export type ChooseWidgetSlotOptions = {
  // Modifier-Key-Override (z.B. Shift+Drop). Bei `true` und ≥1 Slot
  // → immer `action='picker'` (Konzept §9.A.6 Punkt 4).
  force?: boolean;
};

export type ChooseWidgetSlotResult =
  | { action: 'create-template' }
  | { action: 'direct'; slot: WidgetSlotOption }
  | { action: 'picker'; slots: WidgetSlotOption[] };

// Routing-Helper. Pure-Function — keine Side-Effects, keine
// Mutations. Caller verarbeitet das Result-Objekt.
export function chooseWidgetSlot(
  slots: readonly WidgetSlotOption[],
  opts: ChooseWidgetSlotOptions = {},
): ChooseWidgetSlotResult {
  if (slots.length === 0) {
    return { action: 'create-template' };
  }

  if (opts.force) {
    // Force-Mode: User will umentscheiden — Picker auch bei einer
    // Option zeigen (zur Bestaetigung sichtbar).
    return { action: 'picker', slots: sortRootFirst(slots) };
  }

  if (slots.length === 1) {
    const only = slots[0];
    if (only) return { action: 'direct', slot: only };
  }

  const roots = slots.filter((s) => s.isRoot);

  if (roots.length === 1) {
    // Genau ein Root → Konvention „Root hat Vorrang", direkt routen.
    const root = roots[0];
    if (root) return { action: 'direct', slot: root };
  }

  // ≥2 Slots, davon entweder ≥2 Roots oder 0 Roots — beides mal
  // Picker. Sortierung Root-First sorgt fuer prominente Anzeige.
  return { action: 'picker', slots: sortRootFirst(slots) };
}

// Stable-Sort: Roots zuerst, dann nach templateName + sectionLabel +
// slotLabel — deterministisch fuer Test + Cache-Friendliness.
function sortRootFirst(slots: readonly WidgetSlotOption[]): WidgetSlotOption[] {
  const out = [...slots];
  out.sort((a, b) => {
    if (a.isRoot !== b.isRoot) return a.isRoot ? -1 : 1;
    const t = a.templateName.localeCompare(b.templateName, undefined, { sensitivity: 'base' });
    if (t !== 0) return t;
    const sa = a.sectionLabel ?? '';
    const sb = b.sectionLabel ?? '';
    const s = sa.localeCompare(sb, undefined, { sensitivity: 'base' });
    if (s !== 0) return s;
    const la = a.slotLabel ?? '';
    const lb = b.slotLabel ?? '';
    return la.localeCompare(lb, undefined, { sensitivity: 'base' });
  });
  return out;
}
