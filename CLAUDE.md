# Infinite Matrix

## Was das ist

Ein persoenliches Organisations-System, aufgebaut auf einer **rekursiven Matrix-Struktur**. Jede Zelle einer Matrix kann selbst wieder eine Matrix sein — dazu Atome (Tasks / Links / Checklisten / Dokus) halten, die in beliebigen Sichten erscheinen (Kanban, Checkliste, Kalender). Beliebig tief strukturiert: vom groben Lebens-Layout bis zum einzelnen Task.

"Infinite" steht fuer die unbegrenzte Verschachtelung. "Matrix" fuer die zweidimensionale Grund-Struktur (Zeilen × Spalten). Keine starre Hierarchie — eine Landschaft aus Gittern, die man durchwandert.

## Wofuer

Ein Einzelwerkzeug statt Flickwerk aus separaten Apps (Notion + Trello + Todoist + Docs ...). **Offline-first, self-hosted, ohne Drittanbieter-Account** — lokal im Browser (Standalone: localStorage + File System Access API; SaaS-Client: Supabase + IDB-Cache + AES-GCM-verschluesselte Exports). Optional AI-steuerbar ueber eine **selbstgehostete Bridge** (WebSocket + MCP) auf eigenem VPS. Kein Drittanbieter zwischen User und Daten.

Nutzerprofil: jemand, der strukturiert denkt und ein Werkzeug will, das seinen Denkstrukturen folgt — statt ihn in vorgefertigte Schemata zu zwingen.

## Konzepte

- **Matrix** — ein Gitter aus Zeilen und Spalten. Jede Schnittzelle kann Inhalt halten.
- **Zelle** — eine Zeilen/Spalten-Kombination. Traegt Features (`Info` / `Aufgaben` / `Checklisten` / `Sub-Matrix`).
- **Atom** — inhaltliches Objekt mit eigener Aggregat-Tabelle (`tasks`, `links`, `checklists`, `docs`). Lebt **einmal**, erscheint in beliebig vielen **`atom_manifestations`** (kanban / checklist / calendar / standalone). Eine Wahrheit, viele Linsen. Drag-to-Create-Manifestation kreuzt Sichten als USP. Zwiebel-Modell mit 5 Schichten — Detail in `docs/claude/architektur.md` §1.
- **Alias** — User-vergebenes Kuerzel zu einer Zelle / Matrix / Karte / Link, fuer `^kuerzel`-Schnellsprung.
- **Sidebar-Tree** — raeumliche Uebersicht ueber den ganzen Baum, filterbar, navigierbar. Verbindungslinien in Feature-Farben.

## Technik-Rahmen

Zwei Clients:
- **`packages/client-standalone/matrix.html`** — Single-File, Offline-only, eingefroren bei v0.3.0-checklist-v2. Aenderungen bleiben inline, bleiben portabel, bleiben eine Datei.
- **`packages/client-web/`** — SolidJS-SaaS-Client (Supabase-Backend, Multi-Tenant, IDB-Cache, Realtime). Alle neuen Features wandern hierher.

Plus **`packages/bridge/`** — Node + WebSocket + MCP fuer AI-Steuerung. Self-hosted auf User-VPS.

---

## Verbindliche Foundation-Manifeste

**Diese vier Dokumente sind verbindlich.** Jede Aenderung am Code laeuft durch sie. Sie sind die Single-Source fuer Standards — nicht Memories, nicht Code-Kommentare.

| Manifest | Datei | Wann lesen |
|---|---|---|
| **Animations** | [docs/claude/animations.md](docs/claude/animations.md) | Vor jeder UI-Aenderung. Token-System, 20 Pflicht-Pattern, Anti-Pattern, Helper-Library, HyperUI-Eleganz. |
| **Style** | [docs/claude/style.md](docs/claude/style.md) | Vor jeder CSS/Component-Aenderung. Pixel-Regel (rem-Pflicht), Token-System (Spacing/Typo/Color/Radius/Shadow/Z-Index), Inline-Style-Verbot, Komponenten-Standards, WCAG 2.2 AA. |
| **Architektur** | [docs/claude/architektur.md](docs/claude/architektur.md) | Vor jeder Schema-Migration / Mutation / MCP-Tool / Realtime / RLS. Atom-Zwiebel-Prinzip, Single-Source-of-Truth, Schema-Quad, Mutation-Wrapping, Multi-User, Bridge, Git. |
| **Code-Quality** | [docs/claude/code-quality.md](docs/claude/code-quality.md) | Vor jedem Commit. Doublet-Verbot, Dead-Code, Type-Safety, Standards, Tooling, Pre-Commit-Selbstcheck. |

**Regel:** Bevor du Code schreibst, ist das passende Manifest gelesen. Ein Manifest-Verstoss ist kein "Style-Issue" — er ist ein Defekt, gleichwertig wie `alert()` oder `Date.now()`-Position-Default.

---

## Arbeitsprinzipien (Kurzfassung — Detail in den Manifesten)

### Engineering-Qualitaet

1. **Pragmatismus gilt UX, nicht Engineering.** UX-Scope kann V1-reduziert werden; Code-Tiefe bleibt voll. Kein `Date.now()`-Position, kein direktes `supabase.from()` ohne Wrapper, kein Format-Heuristik statt Live-Probe, kein Dual-Write mit Sync-Trigger, kein stiller Misserfolg. Bei Versuchung "kann man das nicht einfacher": **spare ich UX-Komplexitaet (ok) oder Engineering-Aufwand (nicht ok)**.

2. **Single Source of Truth.** Jede Information lebt einmal. Doublet (Funktion / Type / CSS-Klasse / Token) = Review-Stop. Detail in `architektur.md` §2 und `code-quality.md` §1.

3. **Animated, immer.** Jede sichtbare State-Aenderung animiert via Helper aus `lib/animations.ts`. Detail in `animations.md`. Fehlende Animation = Defekt, kein Style-Issue.

4. **Token-Pflicht.** `rem`/`em`/`%` fuer Mass, `var(--token)` fuer Color/Duration/Easing/Spacing. `px` nur fuer Border/Outline/Shadow-Offsets/Icon-Anker. Detail in `style.md` §1.

5. **Globalitaet.** Helper / Types / Hooks / Tokens leben in `lib/` (TS) oder `:root` (CSS). Komponenten konsumieren, niemals re-implementieren.

6. **Offline-Pfad gehoert zur Mutation.** Jede Schreib-Funktion durch `lib/safe-mutation.ts`-Wrapper. Jede Lese-Funktion mit IDB-Cache-Fallback. Tabelle in `offline-cache.ts` TABLES + DB_VERSION-Bump. Detail in `architektur.md` §4.

7. **Schema-Quad-Regel.** Schema + Mutations + MCP-Tools + Export/Import gleichzeitig pflegen. Detail in `architektur.md` §3.

8. **Position-Helper, nie `Date.now()`.** Drop/Move/Insert-Position via `nextPosition*`-Helper. Detail in `architektur.md` §4.5.

9. **Fehler sind UI.** `showToast` + `translateError`. Niemals `alert()`, niemals stiller Catch. Detail in `code-quality.md` §8.

10. **Destruktives kriegt Undo.** Snapshot vor Mutation, `showUndoToast(label, () => restoreX(snap))` nach Mutation.

11. **Focus-Restore bei Modals.** `installFocusTrap` + `installFocusRestore`. Detail in `style.md` §7.

12. **Messbare Verifikation.** Zahlen, nicht "sieht passend aus". Screenshots nur, wenn DOM-Messung nicht reicht.

### Workflow

13. **Risiko-Aktionen bestaetigen lassen.** Destruktives (DROP TABLE, git reset, rm, Branch-Delete, SSH-Migrations) und Aussenwirkung (push, PR, Comment) vorab abnicken lassen. Bei mehrdeutigem Scope `AskUserQuestion` mit Multiple-Choice + Recommended-Marker.

14. **Keine Rueckgaengig-Diskussion.** Wenn User "revertiere" sagt: sofort machen, nicht erklaeren.

15. **Minimal-invasiv.** Eine Aenderung fasst nur das an, was die Aufgabe loest. Ausnahme: erkennbare Style-/Konvention-Drift in Stellen die wir eh anfassen — leise mitsanieren.

16. **Direkt-Merge auf main per Kommando.** Keine GitHub-PRs (siehe `feedback_no_pr_direct_merge.md`).

17. **Deutsch.** UI-Strings deutsch. Kommentare konsistent zur umgebenden Datei. Toast-Text Endkunden-Deutsch, kein Tech-Jargon (`feedback_user_facing_toasts.md`).

18. **Single-File-Constraint (`packages/client-standalone/matrix.html`).** Nichts extrahieren. CSS und JS bleiben in der HTML-Datei. Gilt **nicht** fuer `client-web` (Vite/Solid-Build).

19. **Datenhoheit beim User.** Im Offline-Modus: nichts geht je an einen Server. Im Bridge-/SaaS-Modus: Datenfluss ausschliesslich zum **eigenen** Server (self-hosted VPS), authentifiziert mit User-eigenem Token. Kein Drittanbieter, kein Tracking. Verschluesselung (AES-GCM, PBKDF2, 100k iterations) fuer sensible Exports.

---

## Was NICHT tun (Kurzfassung)

- **Keine harten Sichtbarkeits-Swaps.** `display:none`/`visibility:hidden` nur wenn nichts animiert werden kann. Sonst Opacity/Transform/Max-Height. Detail `animations.md` §3.
- **Keine `px`-Hardcodes** ausser Border/Outline/Shadow/Icon-Anker. Detail `style.md` §1.1.
- **Keine Inline-Styles** ausser Custom-Property-Set. Detail `style.md` §4.
- **Keine Hex/Named-Colors** ausserhalb `:root`. Detail `style.md` §2.
- **Kein `alert()`** / `confirm()` / `prompt()`. Dialog-System verwenden.
- **Keine destruktive Aktion ohne `pushUndo` + `showUndoToast`.**
- **Keine `client-web`-Mutation ohne Offline-Pfad.** Direkte `supabase.from(...).insert/update/delete()` ohne Wrapper = Review-Stop.
- **Kein PostgREST-Embed ueber polymorphen Ref.** `atom_manifestations.atom_id` hat keinen FK. Detail `architektur.md` §1.6.
- **Kein `Date.now()` als Position-Default.** Position-Helper-Pflicht.
- **Kein Dual-Write mit Sync-Trigger.** Single-Source per atom_type-Diskriminator.
- **Kein `*:focus { outline: none }`-Universal-Reset.** Accessibility-Killer.
- **Kein Refactor ohne Auftrag.**
- **Kein "V1-pragmatisch"-Banner fuer Code-Shortcuts.** Pragmatik = UX-Scope, nicht Code-Tiefe.
- **Kein `biome-ignore` als Workaround.** Wenn der Linter anschlaegt → Refactor (Element migrieren / Pattern aendern / Render-Function nutzen / for-of statt forEach), NIE die Suppression. Einzige Ausnahme: dokumentierte Library-Limitation mit Begruendung. Detail `code-quality.md` §5.4.
- **Kein `git clean -fd` im Deploy-Mirror** (`/opt/matrix-repo` auf VPS). Bind-Mount-Volumes wuerden gewischt. Memory `feedback_no_pauschal_git_clean.md`.

---

## Praktischer Ablauf pro Task

1. **Userfrage verstehen.** Bei Unsicherheit `AskUserQuestion` mit Multiple-Choice + Recommended-Marker. Bei mehrdeutigem Scope Plan-Mode.
2. **Relevante Code-Stellen lesen.** Grep/Read direkt bei bekannten Symbolen, `Explore`-Agent nur bei offener Suche ueber mehrere Stellen.
3. **Manifest-Konsultation.** Bei UI-Aenderung: `animations.md` + `style.md`. Bei Schema/Mutation: `architektur.md`. Vor Commit: `code-quality.md`.
4. **Plan bei non-trivialen Implementierungen.** Schreiben, Einwaende offen benennen, `ExitPlanMode` fuer Approval.
5. **Sub-Sprints, wenn > 3 Teilaufgaben.** Plan-Tabelle mit Reihenfolge + Abhaengigkeiten. Pro Sub-Sprint Commit + Push.
6. **Kleine, gezielte Edits.** Pro Sub-Sprint: Token / Pattern / Parser isoliert aendern, *dann* verifizieren.
7. **Pre-Commit-Selbstcheck:** Animation (animations.md §5) + Style (style.md §10) + Architektur (architektur.md §10) + Quality (code-quality.md §12).
8. **Destruktive Aenderungen:** `pushUndo` + `showUndoToast` **bevor** der Commit erfolgt.
9. **Zusammenfassung am Ende.** Tabelle mit Sub-Sprint / Commit-Hash / Messwert-Pointer. Keine Marketing-Sprache.
10. **Branch-Merge erst auf explizite User-Freigabe.**

---

## Pragmatik in der Produktentwicklung (Innovations-Scope)

Pragmatisches Denken ist in **Feature-Vorschlaegen + UX-Entscheidungen** ausdruecklich gewuenscht: Wenn die Aufgabe einen UX-Knoten hat, schlag Optionen vor (klassisch / direkt / ungewoehnlich). Spotting wo eine bewaehrte Bedienkonvention eine bessere Idee braucht (z.B. Drag-to-Create-Manifestation als USP statt klassisches "+ Button").

Schaetzungsweise pragmatische Loesungen die der User eh nicht ausspricht aber haben will:
- "Wenn der Quick-Add eine kleine Lupe statt Plus haette und Enter direkt suchen wuerde — willst du das?"
- "Beim Drill-Up koennten wir den vorigen Cell-Highlight 200ms halten, damit das Auge das Ziel mitnimmt — soll ich?"

Solche Vorschlaege gehoeren ins *Resumee*, nicht in spekulative Implementierungen. Engineering-Tiefe (Mutationen, Cache, Tokens, Animationen) bleibt davon unberuehrt — diese Liste ist UX-Pragmatik, nicht Code-Pragmatik.

---

## Dokumenten-Landkarte

CLAUDE.md ist Single-Entry-Point: Identitaet + Konzepte + Manifest-Verweise + Workflow + VPS-Zugriff. Alles andere ist in Manifesten und wird **nur gelesen, wenn die Anforderung dazu passt**.

| Datei | Inhalt | Lesen wenn ... |
|---|---|---|
| [docs/claude/animations.md](docs/claude/animations.md) | **Animations-Manifest** — Token-System, 20 Pflicht-Pattern, Helper-Library, HyperUI-Eleganz | ... vor jeder UI-Aenderung mit sichtbarem State |
| [docs/claude/style.md](docs/claude/style.md) | **Style-Manifest** — rem-Skala, Token-System, Komponenten-Standards, WCAG | ... vor jeder CSS/Component-Aenderung |
| [docs/claude/architektur.md](docs/claude/architektur.md) | **Architektur-Manifest** — Atom-Zwiebel-Prinzip, Schema-Quad, Mutation-Pfad, Multi-User, Bridge, Git | ... vor jeder Schema-Migration / Mutation / MCP / Realtime |
| [docs/claude/code-quality.md](docs/claude/code-quality.md) | **Code-Quality-Manifest** — Doublet-Verbot, Dead-Code, Type-Safety, Standards, Tooling | ... vor jedem Commit |
| [docs/claude/standards.md](docs/claude/standards.md) | WCAG / OWASP / 12-Factor / systemd / RFCs Detail | ... bei Security/Accessibility/Infra-Aenderung |
| [docs/claude/styles.md](docs/claude/styles.md) | Standalone-spezifische Coding-Standards (Sidebar/Tree/Modal/Toast Patterns aus Phase 0g) | ... bei Standalone-Arbeit (`packages/client-standalone/matrix.html`) |
| [docs/claude/checklisten.md](docs/claude/checklisten.md) | Trigger-basierte Commit-Checklisten | ... vor jedem Commit (mindestens ein Trigger passt immer) |
| [docs/claude/workflow.md](docs/claude/workflow.md) | Kontext-Awareness, Sprint-Aufteilung, Verifikations-Workflow | ... laengere Review-/Refactor-Welle |
| [docs/claude/rollen.md](docs/claude/rollen.md) | Sieben Perspektiven (UX/Arch/Frontend/QA/Security/Perf/Deploy) | ... komplexe Entscheidung mit mehreren Perspektiven |

### Externe Referenzen

| Was | Wo | Wann lesen |
|---|---|---|
| Bridge-Deployment-Plan | `docs/plan-bridge.md` | Bei Bridge-/VPS-Arbeit |
| Backend-Phase-0-Plan | `docs/plan-backend-phase-0.md` | Bei client-web/Supabase-Arbeit |
| Pre-Phase-1-Audit-Reports | `docs/audit/A1..A5-*.md` | Bei Frage zu Audit 2026-04-25 |
| MCP-Tool-Beispiele | `packages/bridge/src/tools/*.ts` | Als Pattern beim Neubau |
| nginx/systemd-Config | `infra/nginx/matrix.conf`, `infra/systemd/matrix-bridge.service` | Bei Deploy/Infra-Arbeit |
| CI/CD-Workflow | `.github/workflows/deploy.yml`, `pr.yml` | Bei CI-Anpassungen |
| Memory-Files (Session-Wissen) | `~/.claude/projects/.../memory/` | Automatisch beim Session-Start gelesen |

**Regel fuer Claude:** Lies nicht praeventiv alle Sub-Dokumente. Nur das, was die aktuelle Aufgabe betrifft. Bei Zweifel — Aufgaben-Scope pruefen, dann gezielt oeffnen.

---

## Infrastruktur-Zugriff

Der Dev-PC hat SSH-Zugriff auf den Staging-/Prod-VPS. Claude darf im Auftrag des Users Infrastruktur-Aktionen via SSH ausfuehren — DB-Bootstrap, Container-Status-Checks, Deploy-Mirror-Updates, Log-Inspektion, einmalige psql-Patches.

**Staging-/Prod-VPS:** `ssh root@87.106.25.91` (Schluessel auf dem Dev-PC eingerichtet). Hier laeuft die Supabase-Stack als Docker-Compose.

**Wichtige Container:**
- `matrix-supabase-db` — Postgres-DB mit allen Migrationen.
- Alle weiteren via `ssh root@87.106.25.91 "docker ps --format '{{.Names}}'"`.

**Postgres-Zugriff:** Im Container als `postgres` ohne Passwort (Trust-Auth via Unix-Socket):
```bash
ssh root@87.106.25.91 "docker exec matrix-supabase-db psql -U postgres -d postgres -c '<SQL>'"
```

`postgres` ist kein Superuser — `CREATE OR REPLACE FUNCTION` funktioniert nur fuer Funktionen die postgres selbst angelegt hat. Funktionen mit Owner `supabase_admin` koennen via diesen Pfad nicht repliziert werden — die User muss das interaktiv mit Passwort machen.

**Wann Claude SSH-en darf:**
- Auf explizite User-Bitte ("trag das auf dem VPS ein", "schau ob X laeuft", "lass mal die Migration laufen").
- Bei Bootstrap-Tasks die nur per service-role gehen (z.B. ersten platform_admin anlegen).
- Bei Smoke-Verifikation nach Deploy (count(*)-Checks etc.).

**Wann Claude NICHT SSH-en darf:**
- Spekulativ "weil ich gerade dran denke" — immer Auftrag abwarten.
- Fuer destruktive Aktionen (DROP, DELETE ohne WHERE, Container-rm) ohne explizite Bestaetigung.
- Bind-Mount-Volumes auf `/opt/matrix-repo/infra/supabase/volumes/db/data/` NIEMALS pauschal cleanen — siehe Memory `feedback_no_pauschal_git_clean.md`.

**Wichtig:** Service-Role-/Admin-Keys + DB-Inhalte NIE in der Konversation loggen. Smoke-Output gefiltert zeigen (`SELECT count(*)`, nicht `SELECT *`). Env-Var-Dumps mit Password-Filter ebenfalls verboten.
