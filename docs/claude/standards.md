# Standards, auf die wir uns berufen

**Wann lesen:** Bei Security-relevanten Änderungen (OWASP), Accessibility-Reviews (WCAG), Infra/systemd-Arbeit, oder wenn ein neuer externer Standard ins Spiel kommt.

---

Die impliziten Qualitätsregeln im Projekt sind an formale Standards angelehnt. Feature-Reviews und Code-Changes prüfen gegen diese Liste als Checkliste — nicht dogmatisch (keine Zeile muss jeden Standard erfüllen), sondern als Messlatte für „State-of-the-Art".

| Standard | Geltungsbereich | Konkret bei uns |
|---|---|---|
| **WCAG 2.2 Level AA** — Web Content Accessibility Guidelines | Client-UI (`client/matrix_tool_beta.html`) | Tastatur-first (`^alias`, `Shift+A`, `+`-Menü), `:focus-visible` scoped (nicht `*:focus{outline:none}`), Kontrast ≥ 4.5:1 in Light+Dark (`--fs-*`-Tokens, Dark-Overrides), `role=`/`aria-*` auf interaktiven Elementen (Checkboxes, Dialogs), 44×44 Tap-Targets bei `@media (max-width:480px)` |
| **OWASP ASVS v4 Level 2** — Application Security Verification Standard | Bridge (`packages/bridge/`), Client-Crypto | V2 Auth: Bearer-Token (`/mcp`) + Query-Param-Token (`/ws`, Browser-Limitation dokumentiert). V5 Input: `sanitizeUrl()` bei `link.add`, `validateAlias()` bei allen Alias-Settern, Zod-Schema-Parse vor jedem Tool-Dispatch. V7 Errors: `translateError()` → deutsche Messages ohne Stack-Leak, `showToast`-Pipeline, niemals `alert()`. V7.1 Audit: `audit_log`-Table in SQLite, jeder Tool-Call mit `args`/`result`/`ok` geloggt |
| **12-Factor App** — stateless, config-driven Service | `bridge/` (Phase 2+) | III Config: `/opt/matrix-bridge/.env` (`PORT`, `HOST`, `BRIDGE_TOKEN`, `DB_PATH`), niemals hardcoded. VI Processes: systemd-Service, stateless Bridge-Prozess, State in SQLite-File. X Dev/Prod-Parity: gleicher Branch, gleiches `pnpm install --frozen-lockfile`. XI Logs: pino → journald, strukturiertes JSON |
| **RFC 6455 (WebSocket) + RFC 6750 (Bearer)** | Bridge Auth-Flow | WebSocket-Upgrade via nginx (`proxy_http_version 1.1`, `Upgrade`/`Connection` headers). Bearer-Token bei HTTP-Routes (`/mcp`), Query-Param-Token bei WS (`/ws?token=...`) — Browser-WebSocket-API kann keine Custom-Headers setzen, das ist explizit im Auth-Code kommentiert |
| **Conventional Commits 1.0 + SemVer 2.0** | Git-Workflow | `<type>(<scope>): <titel>`-Format, Types siehe [architektur.md](architektur.md#conventional-commits-format) (`feat`/`fix`/`refactor`/…). Tags wie `v0.2.0-mcp-v1` bei Meilensteinen. Ein PR = eine Teilleistung. Squash-Merge auf `main` |
| **systemd sandboxing** — freedesktop.org Service-Hardening | `infra/systemd/matrix-bridge.service` | `ProtectSystem=strict` + `ReadWritePaths=/opt/matrix-bridge/data`, `ProtectHome=true`, `ProtectKernel*`, `RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX`, `SystemCallFilter=@system-service` + `~@privileged @resources`, `CapabilityBoundingSet=` (leer), `UMask=0027`. **Ausgeschlossen mit Begründung:** `MemoryDenyWriteExecute=true` — blockiert V8-JIT (Baseline + TurboFan), Node-Service crasht mit SIGTRAP. Dokumentiert inline |

## Wenn ein Standard nicht passt

Dann **explizit begründen im Commit/Code-Comment**, nicht stillschweigend abweichen. Beispiel: die `MemoryDenyWriteExecute`-Ausnahme ist im Unit-File inline kommentiert, damit ein zukünftiger Reviewer nicht denkt, die Abweichung sei ein Versehen.

## Wenn ein neuer Standard relevant wird

- Neuer Zeileneintrag in obiger Tabelle mit Geltungsbereich + „Konkret bei uns"
- Kurzer Hinweis in CLAUDE.md-Abschnitt „Arbeitsprinzipien" oder [styles.md](styles.md), wenn es tägliche Arbeit berührt
- Memory-File anlegen, wenn es ein größerer Schwenk ist (z.B. „Datenschutz-DSGVO-Compliance-Pass vor SaaS-Launch")
