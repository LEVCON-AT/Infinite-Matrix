# B0 — Audit-Log-Coverage

**Datum:** 2026-04-28
**Branch:** feat/backend-polish-rls-audit
**Migration:** 020_audit_log_coverage.sql

## Auftrag

Backend-Polish-Welle 1, Task P.2. Pruefen welche Mutationen heute KEINEN
Eintrag in `workspace_audit_log` erzeugen, und die Compliance-kritischen
Luecken schliessen.

## IST-Stand vor 020

`workspace_audit_log` (Migration 011) wurde bisher nur fuer
Member-Lifecycle befuellt. Die folgenden 9 Action-Strings sind live:

- `invite.created` (011)
- `invite.accepted` (013)
- `invite.revoked` (011)
- `member.deactivated` (013)
- `member.reactivated` (013)
- `member.removed` (013)
- `member.role_changed` (014)
- `workspace.ownership_transferred` (015)
- `workspace.deleted` (015)

**Inhalts-Mutationen (nodes, cells, cards, docs, ...) wurden komplett
nicht geloggt.** Defizit fuer Compliance/Forensik: man kann nicht
nachvollziehen, wer welche Struktur aufgebaut/geloescht hat.

## Luecken-Klassifizierung

### Compliance-kritisch (in 020 gefixt)

| Tabelle | Action-Strings | Severity | Migration |
|---|---|---|---|
| nodes | node.created, node.deleted, node.renamed, node.alias_changed | CRITICAL | 020 |
| kb_cards | card.created, card.deleted, card.moved, card.archived | CRITICAL | 020 |
| docs | doc.created, doc.deleted, doc.renamed, doc.alias_changed | CRITICAL | 020 |

### Nice-to-have (Phase D Follow-up)

| Tabelle | Vorschlag | Severity | Status |
|---|---|---|---|
| rows | row.created, row.deleted, row.renamed | MEDIUM | offen |
| cols | col.created, col.deleted, col.renamed | MEDIUM | offen |
| kb_cols | kb_col.created, kb_col.deleted, kb_col.renamed | LOW | offen |
| checklists | checklist.created, checklist.closed, checklist.deleted | LOW | offen |
| links (board-Links) | link.created, link.deleted | LOW | offen |
| cells | cell.alias_changed, cell.feature_added, cell.feature_removed | LOW | offen |

Diese koennen in einer Phase-D-Follow-up-Migration ergaenzt werden.
Compliance-Bedarf ist minimal weil row/col/kb_col-Aenderungen nur die
Workspace-Struktur betreffen — und die haengt am node-Audit (jede
Zeile/Spalte gehoert zu einem matrix-node).

### Bewusst SKIPPED — Volume-Risk

Diese Mutationen werden **nicht** geloggt, weil sie hochfrequent waeren
und den Audit-Log fluten wuerden:

- `cells.data` JSONB-Aenderungen (Inline-Editor-Tippen in info_fields)
- `kb_cards.name` / `.note` (Inline-Edit-Floods, ~10/sec moeglich)
- `kb_cards.position` bei col-internem Sort (nur cross-col-Move loggen — done in 020)
- `checklist_items.done`-Toggle (~100/min bei aktiver Liste)
- `checklist_items.text` (Inline-Edit)
- `kb_cards.tags` / `.who` / `.deadline` / `.priority` (Mass-Edit-Pfade)
- `doc.content` (Wiki-Editor-Tippen — Volume zu hoch)

Falls Compliance-Owner spaeter doch z.B. Karten-Inhalts-Diffs braucht:
**eigener Audit-Stream `workspace_content_audit_log`** mit eigener
Retention-Policy (z.B. 30-Tage-Auto-Cleanup), getrennt vom Compliance-
Audit. Nicht jetzt.

## Architektur-Entscheidung

**Trigger statt explicit-Calls** in den RPCs/Mutations.

Vorteile:
- Frontend-Code aendert sich nicht — bestehende `runOptimisticInsert/
  Update/Delete`-Wrapper bleiben.
- MCP-Tools / Bridge-Pfade / Direct-SQL-Inserts loggen automatisch mit.
- Schwer "vergessbar" — kein neuer Mutation-Pfad kann Audit umgehen.

Nachteile:
- `actor_id` aus `auth.uid()` lesbar nur wenn Trigger in JWT-Session
  laeuft. Service-Role-Mutationen (Bridge) haben actor_id = NULL.
  Akzeptabel — Bridge-Inserts sind als "system actor" identifizierbar.

**Pattern:** SECURITY DEFINER-Helper `emit_audit_log(workspace_id,
action, payload)` umgeht das deny-all-Policy von workspace_audit_log.
Pro Tabelle eine Trigger-Funktion die je nach `TG_OP` (INSERT/UPDATE/
DELETE) den passenden Action-String emittiert.

## Smoke-Test-Pfad

Nach `bash infra/scripts/supabase-migrate.sh` auf staging:

```sql
-- 1) Helper + Trigger-Funktionen vorhanden?
SELECT proname FROM pg_proc
 WHERE proname IN ('emit_audit_log', 'nodes_audit_emit', 'kb_cards_audit_emit', 'docs_audit_emit')
 ORDER BY proname;
-- erwartet: 4 Zeilen.

-- 2) Trigger registriert?
SELECT tgname, tgrelid::regclass FROM pg_trigger
 WHERE tgname LIKE '%_audit_%'
 ORDER BY tgname;
-- erwartet: 9 Trigger (3× nodes, 3× kb_cards, 3× docs)

-- 3) Funktionaler Smoke (im Browser):
-- - Knoten anlegen → workspace_audit_log hat node.created mit eigener actor_id
-- - Karte erstellen → card.created
-- - Karte in andere Spalte ziehen → card.moved
-- - Doku erstellen + umbenennen → doc.created + doc.renamed
-- - In allen Faellen: actor_id = aktueller User (auth.uid())
```

## Update-Pfad fuer das Frontend

Settings → Workspace → Audit-Log (`routes/settings/WorkspaceAuditLog.tsx`)
zeigt heute eine Action-Liste. Nach 020 fliessen automatisch die neuen
Action-Strings ein. Die Render-Komponente sollte eine human-readable
Mapping-Tabelle haben (z.B. "card.moved" → "Karte verschoben"). Pruefen
ob diese Mapping-Tabelle existiert + ergaenzen falls nicht.

→ **Folge-TODO** (kein Sprint-Item, kleine Nachjustierung):
- `lib/audit-actions.ts` (oder wo immer das mapping liegt) um neue Strings ergaenzen.
- Falls nicht da: pragmatischer Fallback ist `action`-String direkt anzeigen.

## Resultat

Migration 020 schliesst die 3 compliance-kritischen Luecken (nodes,
kb_cards, docs) mit insgesamt 11 neuen Action-Strings. 6 nice-to-have-
Strings bleiben offen (rows, cols, kb_cols, checklists, links, cell-
features) — Phase D Follow-up.

Volume-Risk-Action-Strings sind explizit SKIPPED und in der Migration
dokumentiert (kein "wir haben vergessen", sondern "wir haben bewusst
nicht").
