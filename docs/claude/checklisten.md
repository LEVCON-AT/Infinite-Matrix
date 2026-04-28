# Prüfroutinen (Trigger-basierte Checklisten)

**Wann lesen:** Vor jedem Commit — egal wie klein. Mindestens **ein** Trigger passt immer. Die Liste ist dafür da, dass das Mechanische nicht vergessen wird.

---

Konventionen beschreiben *was* gilt, Prüfroutinen *wann* was zu prüfen ist. Vor jedem Commit gehe ich (die AI) die zum Scope passende Checkliste mechanisch durch — nicht aus Bauchgefühl. Mindestens **ein** Trigger passt bei jeder Code-Änderung.

## Trigger: Feature geändert / neues Feature

- [ ] **MCP-Coverage**: existiert ein `MATRIX_TOOL` für die (neue/geänderte) Mutations-Aktion? Wenn nein: Schema in `packages/bridge/src/tools/<gruppe>.ts` + Client-Handler in `MATRIX_TOOLS` + Vitest + `tool-registry.test.ts`-Count erhöhen. *Selbst-Check: „Kann die AI das Feature headless aufrufen?"*
- [ ] **Destruktiv?** → `pushUndo(label)` vor Mutation, `showUndoToast(label)` danach. Kein `confirm()` in Tool-Handlern.
- [ ] **Offline-Pfad (`client-web`)**: schreibend → läuft die Mutation durch `safe-mutation.ts` (`runOptimisticUpdate`/`-Insert`/`-Delete`) **oder** über einen bereits gewrappten privaten Helper (`updateCard`/`updateCell`/`updateRow`/`updateCol`/`updateKbCol`/`updateChecklist`/`updateItem`/`updateBoardLink`/`updateDoc`/`mutateCellData`/`mutateNodeData`/`readChecklistHistory`)? Direkter `supabase.from(...).insert/update/delete()` ist Review-Stop. Lesend → bei Erfolg `mergeRows`/`putAll`, bei `isNetworkError` → Cache-Fallback (`getByWorkspace`/`getById`) + `markCacheFallback()`. Multi-Step-Operation → in einzelne Specs zerlegen, FIFO-Replay liefert die Reihenfolge.
- [ ] **Error-Pfade**: jeder erwartbare Fehler via `showToast(msg, {type:'error'}) + translateError(err, fallback)`. Niemals `alert()`, niemals nur `console.error`.
- [ ] **Animation**: sichtbare State-Änderung via `transform`/`opacity` + `--tr-std` (220ms) oder `--tr-enter` (180ms). Keine `display:none`-Swaps, keine `setTimeout`-Animationen.
- [ ] **Alias-Index**: mutiert die Änderung `node.alias`/`cell.alias`/`card.alias`/`link.alias` (inkl. Parent-Zugehörigkeit, z.B. cross-board move)? → `rebuildAliasIndex()` nach Mutation.
- [ ] **Settings-Gate**: Feature soll in Edit vs. Non-Edit unterschiedlich erscheinen? → Eintrag in `appSettings.vis.{key}` + `VIS_LABELS` + `isVis('key')`-Check.
- [ ] **Focus-Restore**: öffnet die Änderung ein Modal? → `_pushFocusRestore()` beim Open, `_popFocusRestore()` beim Close. Plus `_pushModal(closeFn)`/`_popModal`.
- [ ] **Tokens vor Literals**: neue Magic-Number / Hex-Color / ms-Duration → existiert Token in `:root`? Falls ≥2× verwendet, neuen Token anlegen.

## Trigger: Fehlermeldung / Toast-String hinzugefügt

Endkunden-tauglichkeit ist nicht verhandelbar. Tech-Jargon im Toast macht die App unprofessionell — und ohne Tech-Detail im Console-Log ist Debugging hart. Die Trennung ist mechanisch.

- [ ] **Doppel-Pattern**: jede `catch`-Branch hat `console.error('<funktionsname>:', err)` **vor** dem `showToast(...)`. Funktions-Name als Prefix damit Devtools-Search filtern kann.
- [ ] **Toast-Sprache**: DE, voll-sätzig, lösungsorientiert ("Bitte erneut einloggen.", "Workspace nicht gefunden — wurde er evtl. gelöscht?"). Kein generisches "Fehler beim XYZ" ohne Konsequenz für den User.
- [ ] **Verbotene Tech-Begriffe im Toast**: RLS, FK, JSONB, CASCADE, SECURITY DEFINER, RPC, Postgres, HTTP-Codes, SQL-Error-Codes, Stack-Traces. Auch nicht "schemaverletzung" oder ähnliche DB-Wörter.
- [ ] **`translate*Error`-Funktion** statt Inline-Strings. Bei neuer Mutation eine eigene Translator-Funktion (analog `translateMemberError`/`translateInviteError`/`translateLifecycleError`).
- [ ] **Sweep im Vorbei**: berührt der Sprint einen `catch`-Block, der heute noch tech-jargon im Toast hat oder kein `console.error` vorab? → mitsanieren. "Bessere bestehende aus, wo du am Weg drüber kommst" (User-Direktive 2026-04-26).

## Trigger: Cascade-Delete / FK auf Aggregat-Wurzel

Aggregat-Wurzeln (`workspaces`, später `users`) haben einen Strudel an Tabellen, die mitsterben. FK-Cascade ist die Versicherung dafür — aber nur wenn lückenlos. Eine SET NULL/RESTRICT-Stelle blockiert den Delete still.

- [ ] **`pg_constraint`-Sweep vor der Migration**: alle FKs auf das Ziel-Aggregat enumerieren:
  ```sql
  SELECT conname, conrelid::regclass, confrelid::regclass, confdeltype
    FROM pg_constraint
   WHERE confrelid = 'public.<aggregat>'::regclass
     AND contype = 'f';
  -- Erwartet: alle confdeltype = 'c' (CASCADE).
  ```
- [ ] **Lücken in derselben Migration schließen** mit `ALTER TABLE ... DROP CONSTRAINT ... ADD CONSTRAINT ... ON DELETE CASCADE` — bevor die neue Delete-Logik kommt, sonst FK-Violation bei jeder Cascade-Welle.
- [ ] **Welche Tabellen sterben mit?** Im Migration-Header explizit auflisten (memberships, nodes, cells, …) — Reviewer sieht den Blast-Radius.
- [ ] **Audit-/Forensik-Frage**: cascadiert das `*_audit_log` mit? Gewollt für die meisten Workspace-scoped Logs — falls Forensik-Anforderung anders, eigener `system_audit_log` (nicht workspace-scoped).
- [ ] **Smoke-Verifikation**: nach Migration & Delete `SELECT count(*) FROM <jede-cascadende-tabelle> WHERE <fk> = '<deleted-id>'` — alle 0.

## Trigger: Settings/IA-Erweiterung denkbar

Die `Settings.tsx`-Sub-Nav ist heute ein einfaches Array. Erweiterungen kosten zwei Zeilen — aber leere Stub-Tabs sind Lieblosigkeit, der User merkt das.

- [ ] **Vor Phase-2+ Sprints fragen**: passen typische SaaS-Bereiche (Plan & Billing, Integrations, Webhooks, API-Keys, Notifications, GDPR-Export) als Sub-Tabs in die bestehende Struktur? Wenn ja, in welche Sub-Nav-Gruppe (`account/` vs. `workspace/`)?
- [ ] **Keine Stub-Tabs vorab anlegen** ("coming soon"-Tabs versprechen einen Termin, den wir nicht halten).
- [ ] **Architektur-Hooks vorbereiten statt Stubs**: `workspace_id`-Scope ist natürlicher Anker für Webhook-Trigger / Billing-Kontext / Audit-Forwarding. Wenn ein Sprint diese Hooks ohnehin anlegt, daran denken.
- [ ] **Bottom-Sektionen für Lifecycle-Aktionen**: Owner-only-destruktive Aktionen (Delete, Transfer) gehören unter `<workspace>/general` als visuell abgesetzte "Gefahren-Zone", nicht als eigener Sub-Tab — überkomplex für 1-2 Buttons.
- [ ] **Suchbar-Index pflegen**: jeder neue Sub-Tab oder jede neue `<h3>`-Sektion → Eintrag in `packages/client-web/src/lib/settings-search.ts` `SETTINGS_SEARCH_INDEX`. Stabile DOM-`id` auf den `<h3>` setzen + im Index als `anchorId` referenzieren. Sonst findet die F-Hotkey-Suche im Settings-Header den neuen Bereich nicht.

## Trigger: Neues UI-Element (Button, Row, Modal, Chip, …)

- [ ] **Tastatur**: `tabindex="0"` wenn interaktiv erreichbar, `-1` wenn über Kontextmenü zugänglich. `onclick` + `onkeydown` für Enter/Space (rolle­spezifisch).
- [ ] **Semantik**: `role=`/`aria-*` wenn nicht natives Element (z.B. `<span role="button" aria-label="…">`). Bei Checkboxes `aria-checked=…`.
- [ ] **Focus-Styling**: Element matched den `:focus-visible`-Scope in [styles.md](styles.md) (Reset nicht global). Neue Klassen ggf. zur Scope-Liste ergänzen.
- [ ] **Mobile-Tap**: `@media (max-width:480px)` min 44×44 px für Ico-Buttons, min 40 px Höhe für `.btn`.
- [ ] **Dark-Mode**: Farben via Token oder `data-theme="dark"`-Override geprüft. Kein `style="color:#333"` inline.
- [ ] **Inline-Styles**: keine statischen `style="…"` — nur dynamische Werte (User-Input, berechnete Position) als `style="--x:${v}"` mit CSS-Klasse die `var(--x)` liest.
- [ ] **Kontext-Rückbindung**: öffnet das Element ein Menü/Dialog? → Breadcrumb oder Source-Highlight zeigen, damit User sieht „worauf" gewirkt wird.

## Trigger: Strukturelle Änderung (neue Tabelle / Spalte / FK / Feature)

Schema-Änderungen dürfen nicht isoliert bleiben. Für jede strukturelle Änderung durchläuft der Change **vier Artefakte** — Export/Import ist gleichrangig zu MCP (ohne Export-Nachzug gibt es stille Datenverluste beim Round-Trip).

- [ ] **DB-Schema** in `infra/supabase/migrations/*.sql` — Tabelle/Spalte/FK angelegt, idempotent, mit ON DELETE-Verhalten definiert.
- [ ] **Client-Mutations** in `packages/client-web/src/lib/mutations.ts` — CRUD-Helper (`add*`, `set*`, `del*`) plus ggf. `restore*` für Undo.
- [ ] **MCP-Tool-Trio**: Bridge-Schema in `packages/bridge/src/tools/<gruppe>.ts` + Client-Handler in `MATRIX_TOOLS` + Vitest (siehe [architektur.md](architektur.md#tool-trio-regel)).
- [ ] **Export/Import** in `packages/client-web/src/lib/export.ts` + `lib/subtree-import.ts`:
  - [ ] Neue Tabelle: `WorkspaceExport`-Shape erweitert, `fetchWorkspaceRowsForExport` lädt sie, alle `export*`-Varianten filtern sie subtree-korrekt, `parseImportPayload` liest sie tolerant, Import-Insert in FK-sicherer Reihenfolge, Clear-Helpers (für Overwrite-Modus) räumen sie auf.
  - [ ] Neue Spalte: Spread `{ ...row }` deckt's ab; FK-Spalten explizit per `remap(...)` durchreichen.
  - [ ] Neuer FK: Remap-Map um das Feld erweitern.
  - [ ] Neues Cell-Feature: prüfen ob ein eigener `feature-<name>`-Export/Import nötig ist.
  - [ ] JSONB-Felder mit embedded IDs: Remap auch dort (wie `kb_cards.checklist_ref` in `kb_cards.checklist[].id` wäre der Pattern).
  - [ ] `formatExportStats` / `summarizeExport`: Count für den neuen Typ anzeigen.
- [ ] **Insert-Default via `auth.uid()`**: Wenn die neue Spalte einen `DEFAULT auth.uid()` hat, greift dieser nur für JWT-Inserts. Bridge-Tools mit Service-Role bekommen `auth.uid() = NULL` → entweder explicit-Param in Tool-Signatur ergänzen oder NULL-Akzeptanz im UI dokumentieren (z.B. "Ersteller unbekannt"-Avatar).
- [ ] **Import-Identitäts-Felder**: Felder die User-Identität tragen (`created_by`, `actor_id`, ...) müssen im `subtree-import.ts` aus dem Payload entfernt werden, damit der Default für den importierenden User greift — nicht 1:1 vom Ursprungs-Workspace übernehmen.

Merksatz: *Jede strukturelle Änderung braucht den Vier-Artefakte-Durchlauf — Schema + Mutations + MCP + Export/Import.*

## Trigger: Neues MATRIX_TOOL / Bridge-Endpoint

- [ ] **Tool-Trio vollständig**: Schema + Client-Handler + Vitest (siehe [architektur.md](architektur.md#tool-trio-regel)).
- [ ] **Zod-Schema**: jedes Feld mit `.describe('…')` für JSON-Schema-Readability in MCP-Inspector.
- [ ] **zod-json-Deckung**: benutzter Zod-Typ ist in `util/zod-json.ts` abgedeckt? Wenn neu (z.B. `z.tuple`), erweitern.
- [ ] **Registry-Test**: neuer Tool-Name in `packages/bridge/test/tool-registry.test.ts` expected-Liste + `tools.size`-Count erhöht.
- [ ] **Return-Shape**: Erfolg `{verb:true, …details}`, Fehler `{error:'<deutsch, konkret>'}`. Nie werfen, nie `undefined`.
- [ ] **Defensive Kopien**: bei Array-/Object-Returns `.slice()` / `JSON.parse(JSON.stringify(…))` — kein Leak auf internen State.
- [ ] **Ref-Resolver**: neue Ref-Form? Muster `^`-Prefix strippen + Alias-Index zuerst + Raw-ID-Fallback + Typ-Check, analog zu `_resolveNodeRef`/`_resolveBoardRef`/`_resolveCardRef`.
- [ ] **URL-Input**: landet ein URL-String im State? → `sanitizeUrl()` davor. **Alias**: `validateAlias(val, oldAlias)` mit canonical `v.alias` speichern.

## Trigger: AI-Pipe / MCP-RPC (Cloud) / Wizard ändern

Berührt `lib/ai-assist/*`, `lib/wizard-*`, `components/wizard/*`,
`components/AiHelpDrawer*`, `infra/supabase/migrations/02x_*.sql`
mit `mcp_*`-RPCs oder den `WIZARD_PROPOSE_TOOL`? Die Cloud-AI-Pipe
hat **drei Schichten** (System-Prompt / Tool-Allowlist / dispatchTool)
plus **zwei UI-Konsumenten** (Drawer A.3 + Wizard A.4). Jede Schicht
muss zur nächsten passen — ohne diesen Sweep zerreißt die
Mitigation-Stack-Logik leise.

Pattern-Files:
- Tool-Registry: `packages/client-web/src/lib/ai-assist/tools.ts`
  (`TOOL_REGISTRY`, `WIZARD_PROPOSE_TOOL`, `TOOL_REGISTRY_FULL`,
  `allowedToolsForMode`)
- Dispatcher: `packages/client-web/src/lib/ai-assist/index.ts`
  (`dispatchTool`, `ITER_CAP`, special-case-Bypass für
  `WIZARD_PROPOSE_TOOL_NAME`)
- System-Prompt: `packages/client-web/src/lib/ai-assist/system-prompt.ts`
  (`WIZARD_BLOCK` / `HELP_BLOCK` / `CELL_SUGGEST_BLOCK`)
- MCP-RPCs: `infra/supabase/migrations/021_mcp_tools.sql` (Pattern
  für SECURITY DEFINER + `_mcp_validate_*`), `022_log_ai_call.sql`,
  `023_create_workspace_rpc.sql`
- Wizard-Apply: `lib/wizard-apply.ts`, Wizard-State:
  `lib/wizard-state.ts`, Wizard-Steps: `components/wizard/Step*.tsx`

Checks:

- [ ] **Tool-Allowlist (Mitigation B)**: pro neuem `ToolDef` die Felder `riskLevel` (`safe`/`destructive`) + `allowedInModes` (Subset von `wizard`/`help`/`cell-suggest`). Forbidden-Tools (account, workspace-lifecycle, webhooks, bulk) tauchen NICHT als `ToolDef` auf — der LLM darf nicht mal wissen dass es sie gibt. `TOOL_MAP` und `allowedToolsForMode` bauen automatisch aus `TOOL_REGISTRY_FULL`.
- [ ] **MCP-RPC anlegen** (neue Migration `02x_*.sql`): `SECURITY DEFINER` + `SET search_path = public, extensions` + `auth.uid()`-NULL-Check + `public._mcp_assert_writer(workspace_id)` + Args-Validation via `_mcp_validate_label`/`_mcp_validate_alias` (Migration 021). `GRANT EXECUTE ... TO authenticated`. Frontend-Tool-`p_*`-Args matchen die SQL-Args 1:1; auch Defaults vermeiden — required-Schema im Tool zwingt den LLM zu vollen Args.
- [ ] **Wizard-only Tools (Mitigation H)**: kein RPC, sondern Args-Passthrough. Pattern: separater `ToolDef`-Slot (siehe `WIZARD_PROPOSE_TOOL`), `dispatchTool` faengt `tu.name === WIZARD_*_TOOL_NAME` ab und reicht `tu.args` als `data` zurueck. NICHT in `TOOL_REGISTRY` aufnehmen — Anhang via `TOOL_REGISTRY_FULL`.
- [ ] **System-Prompt-Sync** (`system-prompt.ts`): WIZARD/HELP/CELL_SUGGEST_BLOCK referenzieren die im Mode erlaubten Tools implizit ueber die Tool-Liste am Ende. Bei Tool-Add: prüfen ob System-Prompt-Anweisung den Tool-Use begründet ODER explizit verbietet ("ruf KEIN anderes Tool"). Bei Mode-Add: neuen Block + `buildSystemPrompt`-Switch.
- [ ] **Iter-Cap (Mitigation D)** in `ITER_CAP`-Record: bei neuem Mode Eintrag ergänzen. Wizard hat 5 (single-tool-Pfad), Help/Cell-Suggest 10. Kein Mode > 50 ohne klaren Grund.
- [ ] **Confirm-Modal (Mitigation C)**: destructive-Tool? → `confirmDestructive`-Callback im Caller (Drawer/Wizard) hinterlegen. `dispatchTool` lehnt ohne Callback hart ab — never silent-execute.
- [ ] **Read-Only-Modus (Mitigation G)**: neuer Caller setzt `readOnly` explizit. Wizard `false` (eigener Workspace), Drawer `true` bei Multi-Member-Foreign-Cell. Kein implizites Default.
- [ ] **Audit-Log (Mitigation I)**: `log_ai_call`-RPC (Migration 022) wird von `runAssist` automatisch gerufen. Neue Provider-Kind oder neue Felder? → Migration ergänzen, Frontend-Helper `lib/ai-assist/audit.ts` mit-erweitern.
- [ ] **Args-Validation server-side (Mitigation J)**: kein Trust auf Frontend-`maxLength`. Pro Args-Feld in der RPC ein `_mcp_validate_*` aufrufen oder neuen Helper anlegen. Errors strukturiert (`USING ERRCODE = 'check_violation'`); Frontend reicht `error.message` an LLM zurueck als `tool_result`-Error.
- [ ] **Wizard-Apply-Sync**: wenn `WIZARD_PROPOSE_TOOL.inputSchema` erweitert wird (neue Children-Typen, neue Sub-Strukturen), MUSS `lib/wizard-apply.ts` mit-erweitert werden — sonst zeigt die Preview Vision, die nicht angelegt wird (Erwartungs-Diskrepanz). Trios: `parseProposal` in `StepProposing.tsx` (neue Felder + `selected:true`-Default) + `lib/wizard-state.ts` (`Proposal*`-Types) + `applyBoardChildren`/`applyMatrixChildren` in `wizard-apply.ts` (neue Apply-Logik) + `components/wizard/StepPreview.tsx` (Render + Checkbox-Selection). Failures werden in `failedItems` (scope/label/error) gesammelt — kein silent-`console.warn`.
- [ ] **Provider-Cache** (`lib/ai-providers.ts`): jede Mutation (`setAiProvider`/`setAiProviderDefault`/`deleteAiProvider`) ruft `invalidateProviderCaches()` (= `clearProviderCredentialCache()` aus `lib/ai-assist/credential` + `cachedAccessor=null`). Sonst nutzt der naechste `runAssist` den alten Default-Key.
- [ ] **Provider-Adapter erweitern**: V1 nur Anthropic. OpenAI/Gemini-Adapter in `lib/ai-assist/providers/<kind>.ts` mit `streamCompletion`-Equivalent. Tool-Schema-Konvertierung aus Anthropic-Format zu Provider-Format. `runAssist` switch erweitern. Tools-Allowlist + System-Prompt bleiben provider-agnostisch.
- [ ] **Live-Test-Plan**: F12-Network-Inspect des `POST /v1/messages`-Body — `tools[]` enthält nur Mode-allowed Tools, `system` enthält Mode-Block + Tool-Liste, `messages` enthält `contextSnapshot` als user-Role-Message (nicht im system-prompt). Console-Errors in `runAssist (<mode>):`-Prefix sichtbar.

Merksatz: *Tool-Allowlist + System-Prompt + dispatchTool + Wizard-Apply müssen synchron sein. Eine Schicht alleine ändern brennt leise.*

## Trigger: Neue Tastatur-Shortcut / Keyboard-Interaktion

- [ ] **Konfigurierbar?** → Eintrag in `DEFAULT_KEYBINDINGS` + `KB_ACTIONS`, Check via `matchShortcut(e, 'actionName')`.
- [ ] **Fix?** → in `fixedRows`-Liste von `showKeyboardHelp()` dokumentieren.
- [ ] **In Text-Input geschützt?** → Guard `!event.target.matches('input,textarea,[contenteditable]')` bei Alphazeichen-Shortcuts (wie Shift+R).
- [ ] **Overlay mit ESC**: `document.addEventListener('keydown', h, true)` (Capture) + `ev.stopImmediatePropagation()` im Handler, sonst schluckt globaler Back-Handler das Event.

## Trigger: Multi-User-Awareness erweitern (Presence / Live-Cursor)

Wenn ein neues Hover-Ziel sichtbar werden soll (z.B. Doc-Link, Aggregat-Spalte, …) oder ein neuer statischer Member-Indikator angezeigt wird, läuft die Änderung durch **fünf Stellen**. Eine zu vergessen heißt: stale Cursor bei anderen Usern oder „Avatar-Geist" auf der letzten Position.

- [ ] **Schema** in `packages/client-web/src/lib/presence.ts`:
  - [ ] Neues Feld in `PresencePosition` UND `PresenceUser` (gleicher Name, gleicher Type).
  - [ ] `buildPayload()` reicht das Feld in den Track-Payload.
  - [ ] `rebuild()` liest es aus den `meta`-Objects (mit `typeof ... === 'string'`-Guard).
  - [ ] Identitäts-Check in `setUsers`-Vergleich (sonst feuert das Signal nicht bei reinem Hover-Wechsel).
- [ ] **Hoist-Punkt** in `packages/client-web/src/routes/Workspace.tsx`:
  - [ ] `createSignal<string | undefined>(undefined)` für den Hover-State.
  - [ ] In `presencePosition`-Memo aufnehmen.
  - [ ] An die jeweilige Page/Component reichen + `selfUserId` + `presenceUsers`-Accessor.
- [ ] **Component-Pfad**:
  - [ ] `presenceByXxx`-`createMemo<Map<id, PresenceUser[]>>` baut einmal die Lookup-Map (nicht pro Item filtern — das skaliert mit O(items × users)).
  - [ ] `onMouseEnter`/`onMouseLeave` auf dem DOM-Ziel feuern den Callback.
  - [ ] `onCleanup(() => onXxxHover(undefined))` — sonst bleibt der Cursor bei anderen Usern auf der letzten Position stehen (Page-Wechsel, Modal-Close, etc.).
  - [ ] `<PresenceMini users={presenceByXxx().get(id) ?? []} />` als absolute Overlay-Schicht.
  - [ ] Container braucht `position: relative` + `pointer-events:none` auf `.presence-mini` damit der Click-Pfad nicht blockiert wird.
- [ ] **Subscription bleibt zentral**: `usePresence` wird **nur einmal** in `Workspace.tsx` aufgerufen. Wenn eine neue Component Presence braucht, reichst du den Accessor durch — nicht erneut subscriben (Quota + Channel-Doppelung).
- [ ] **Static Member-Avatar (NT-Pattern)**: wenn das Feld eine User-Referenz IST (created_by, last_modified_by, …) statt nur Hover-State, gilt zusätzlich der **Schema-Quad** (siehe oben „Strukturelle Änderung") — Tabelle + Mutations + MCP + Export/Import + Members-Lookup.

Merksatz: *Hover-Felder leben in `PresencePosition` + `PresenceUser` + `buildPayload` + `rebuild` + `setUsers`-Diff. Fünf Stellen, sonst ist der Cursor kaputt.*

## Trigger: Vor dem Commit (jede Änderung, immer)

- [ ] **Diff gelesen**: `git diff --cached` manuell durchgegangen — keine `console.log`, keine Dead-Code-Reste, keine TODOs ohne Ticket-Referenz, keine Secrets.
- [ ] **Preview-Smoke**: `preview_eval window.location.reload()` + gezielte DOM-Messung + `preview_console_logs level:"error"` leer. Bei großen JS-Edits: Cache-Buster-URL.
- [ ] **Messbar verifiziert**: Zahlen statt Adjektive — `maxDelta < 1px`, `toolsCount === 37`, nicht „sieht passend aus".
- [ ] **Commit-Message**: Conventional-Commits-Format, Co-Authored-By-Trailer, Scope passt (`feat(bridge/tools)` / `fix(client)` / `docs(claude)` / …).
- [ ] **Standards-Abgleich**: Änderung berührt Security / Accessibility / Infra? → Kurz gegen den passenden Standard (OWASP ASVS / WCAG / 12-Factor / systemd) prüfen — siehe [standards.md](standards.md).
- [ ] **Destruktive Git-Aktion nur mit Auftrag**: kein `reset --hard`, `push --force`, `--no-verify` ohne explizite User-Freigabe.

## Wenn eine Checkbox scheitert

Nicht weichklopfen. Entweder:
- **Fix sofort** wenn ≤ 5 Minuten (Animation hinzufügen, Token einführen, Vitest-Assert ergänzen)
- **Im gleichen Commit nachziehen** wenn logisch Teil der Änderung (MCP-Tool zum neuen Feature)
- **Explizit als Follow-up-Todo** in TodoWrite eintragen wenn separater Aufwand (SSH-Hardening-Style)

Niemals „mach ich später, merk ich mir eh" — wird garantiert vergessen.
