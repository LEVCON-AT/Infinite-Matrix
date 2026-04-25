# AU-A5 — Trigger-Checklisten retroaktiv

**Datum:** 2026-04-25
**Scope:** 14 Audit-Welle-Commits seit `fa3e514` (AU-Q1) gegen `docs/claude/checklisten.md`
**Methode:** Pro Commit Trigger-Match-Check + Kategorie-Walk

---

## TL;DR

**14 von 14 Commits sind trigger-konform.** Eine bewusste Token-Lücke (`--fs-base`/`--fs-small`) ist bereits im AU-A4-Report dokumentiert. Keine zusätzlichen Mini-Sprints aus diesem Audit, der Audit-Pfad selbst hat seine eigenen Standards getroffen.

---

## Trigger-Mapping pro Commit

| Commit | Sprint | Typ | Primärer Trigger | Konform? | Anmerkung |
|---|---|---|---|---|---|
| `fa3e514` | Q1 | refactor | Feature geändert | ✅ | Tokens-vor-Literals (FrequencyMatrix-Konstanten), war der Sprint-Inhalt. |
| `d8d8fe9` | Q2 | refactor | Feature geändert | ✅ | Wiederverwendung (`buildAliasEntries`, `tokenizeAliasText`). |
| `48bac58` | Q3 | refactor | Feature geändert | ✅ | DRY (`lib/cell-data.ts` als Single-Source-of-Truth). |
| `be7bc3c` | A1 | docs | Vor dem Commit | ✅ | Pure docs (`A1-rollen-findings.md`). |
| `a6fd1d3` | A1.3 | fix | Feature geändert (Offline-Pfad) | ✅ | IDB-Schema-Bump auf v2; nicht Vier-Artefakte-pflichtig (IDB-Cache ist Client-State, nicht Persistenz-Schema). |
| `659987f` | A1.4 | fix | Feature geändert (Sanitization) | ✅ | URL-Sanitization auf Render+Import-Pfad ergänzt. |
| `92bed05` | A1.2 | fix | Feature geändert (Offline-Pfad) | ✅ | Checklist-Mutationen durch `safe-mutation`-Wrapper geschoben. |
| `6f2a447` | A1.1 | fix | Feature geändert (Error-Pfade) | ✅ | `window.confirm/prompt` ersetzt durch `DialogHost`-Pipeline. |
| `eaf8da1` | A1.5 | fix | Neues UI-Element | ⚠️ | Token-Lücke `--fs-base`/`--fs-small` (siehe Ausstand). |
| `a3f7918` | A1.7 | fix | Feature geändert (Memory-Leak) | ✅ | `bindAliasAutocomplete`-Cleanup in 6 ref-Callbacks. |
| `42d7731` | A1.8 | ci/infra | Vor dem Commit | ✅ | CI-Path-Filter + Tempfile-Hygiene; biome-Lint nicht broken. |
| `15aaae3` | A1.9 | perf | Feature geändert (Perf) | ✅ | Replay-Lock WS-scoped, Alias-Lookup O(1), Frequency-Memos. |
| `9eb176b` | A2 | fix(bridge) | Feature geändert + Standards (ASVS) | ✅ | URL-Constructor-Validation + ASVS-Verify-Report. |
| `a72a7cc` | A3 | feat | Neues UI-Feature + Standards (WCAG-AA) | ✅ | Focus-Trap-Helper + Kontrast-Token-Update + `aria-modal`. |
| `4efd875` | A4 | docs | Vor dem Commit | ✅ | Findings-Report + 1-Liner-Animation-Token-Fix. |

---

## Trigger-Kategorie-Audit

### Trigger: Feature geändert / neues Feature
- **MCP-Coverage**: nicht relevant — kein neues Mutations-Feature im Audit, alles Refactor/Fix.
- **Destruktiv → Undo**: nicht relevant (keine neue del*-Mutation in Audit-Welle).
- **Offline-Pfad**: AU-A1.2 hat genau diesen Pflichtpunkt aufgegriffen. AU-A1.3 IDB-Bump folgt dem Pattern.
- **Error-Pfade**: AU-A1.1 (Dialog-Pipeline) + AU-A2 (CORS-Validation mit Warn-Logging) decken das.
- **Animation**: AU-A4 hat das letzte Hard-Coded-ms-Vorkommen auf `var(--tr-enter)` gezogen.
- **Alias-Index**: AU-Q2 hat das O(1)-Lookup-Refactoring durchgezogen — Pattern eingehalten.
- **Settings-Gate**: nicht relevant in Audit.
- **Focus-Restore**: AU-A4 hat die Lücke (10 Modals ohne Restore) als Mini-Sprint AU-A4.3 markiert.
- **Tokens vor Literals**: AU-Q1 (FrequencyMatrix-Konstanten) + AU-A4 (Animation-Token) eingehalten. **Eine Lücke**: `--fs-base`/`--fs-small`-Tokens fehlen, AU-A1.5 verwendet `13px`/`14px` als Literal — siehe Ausstand.

### Trigger: Neues UI-Element
- AU-A1.5 (`ImportDialog`-CSS-Block): UI-Element bereits vorhanden, nur CSS ergänzt. Tastatur-Pfad / aria/Tap-Targets bereits in Component-Code.
- AU-A3 (Focus-Trap in DialogHost, aria-modal in 4 weiteren Modals): Tastatur-/Semantik-Trigger explizit erfüllt.

### Trigger: Strukturelle Änderung (Schema + Mutations + MCP + Export/Import)
- **Keine** strukturelle Änderung in der Audit-Welle. Vier-Artefakte-Regel daher nicht aktiviert.

### Trigger: Neues MATRIX_TOOL / Bridge-Endpoint
- **Keine** neuen MATRIX_TOOLs. Bridge-Änderung in AU-A2 betraf nur den CORS-Setup-Pfad, kein Tool-Schema.

### Trigger: Neue Tastatur-Shortcut
- **Keine** neuen Shortcuts. AU-A3 hat Focus-Trap (Tab/Shift+Tab) auf bestehende Modals angewendet — kein neuer Shortcut, sondern Verhalten.

### Trigger: Vor dem Commit (immer)
- **Diff gelesen**: ja, jeder Commit hat einen kurz-kommentierten Body.
- **Type-Check / Lint**: jedes A-/Q-Commit lief mit `tsc --noEmit` grün; AU-A4 hat den Lint-Stand explizit dokumentiert (218 Errors als bekannte Audit-Backlog).
- **Messbar verifiziert**: Bridge-Tests 177/177 grün durchgehend; A2 mit Live-Curl-Tests; A3 mit Type-Check.
- **Commit-Message**: Conventional-Commits-Format mit Scope, Co-Authored-By-Trailer.
- **Standards-Abgleich**: AU-A2 (OWASP ASVS V14.5/V13.1.1/V7.3.3), AU-A3 (WCAG 2.2 AA Kontrast 1.4.3 + Focus-Trap 2.1.2).

---

## Ausstände

### A1: Token-Lücke `--fs-base` / `--fs-small`

**Quelle:** AU-A1.5 (Commit `eaf8da1`).

**Symptom:** `.import-card` und `.import-textarea` setzen `font-size: 13px`/`14px` als Literal, weil das `:root`-Token-Set keine `--fs-base`/`--fs-small`-Werte hat (nur `--fs-title` und `--fs-subtitle` sind via clamp definiert).

**Empfehlung:** In einem AU-A4.4-Mini-Sprint (Lint-Quick-Wins) zwei neue Tokens anlegen:
```css
:root {
  --fs-base: 14px;
  --fs-small: 13px;
}
```
und alle Inline-Vorkommen ersetzen. Stichprobe via `Grep "font-size:\s*1[34]px"` durchziehen.

**Risiko:** niedrig.

**Priorität:** zusammen mit AU-A4.4 erledigen.

---

## Konsequenz für Phase 1

Audit-Welle ist trigger-konform, kein zusätzliches Pre-Phase-1-TODO aus dieser Prüfung. Die in AU-A4 markierten Follow-ups (A4.1–A4.4) tragen das, was hier als Mini-Lücke auftaucht, ohnehin schon mit.
