# Infinite Matrix

Ein rekursives Matrix-Organisations-System für strukturiertes Denken. Jede Zelle kann Info, Kanban, Checklisten und eine Sub-Matrix halten — beliebig tief. Offline-first, lokal, tastatur-zentriert.

## Monorepo-Layout

```
client/   Single-File-HTML-Client (matrix_tool_beta.html)
bridge/   Node+TypeScript Backend (WebSocket + MCP-Server, ab Phase 1)
infra/    nginx-Config, systemd-Unit, VPS-Setup-Scripts
docs/     Pläne, Protokoll-Referenzen, Runbook
V1/       Laufende User-Arbeitskopie der App (nicht deployt, nicht gelintet)
```

## Start

Lokaler Preview des Clients: `preview_start matrix` (via `.claude/launch.json` → Python http.server auf Port 3848, cwd `client/`).

Bridge und Deployment laufen ab Phase 1 des Plans — siehe [docs/plan-bridge.md](docs/plan-bridge.md).

## Hintergrund

- Konzept & Prinzipien: [CLAUDE.md](CLAUDE.md)
- Aktueller Fahrplan: [docs/plan-bridge.md](docs/plan-bridge.md)
- Offene Themen: [BACKLOG.md](BACKLOG.md)
