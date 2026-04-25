# Infinite Matrix

Ein rekursives Matrix-Organisations-System für strukturiertes Denken. Jede Zelle kann Info, Kanban, Checklisten und eine Sub-Matrix halten — beliebig tief. Offline-first, lokal, tastatur-zentriert.

## Monorepo-Layout

```
packages/
  client-web/         SolidJS + Vite SaaS-Client (Supabase-Backend, Multi-Tenant, PWA)
  client-standalone/  Single-File-HTML-Client (frozen at v0.3.0-checklist-v2)
  bridge/             Node+TypeScript Backend (WebSocket + MCP-Server)
  shared/             Geteilte Typen
infra/                nginx-Config, systemd-Unit, VPS-Setup-Scripts, Supabase-Migrations
docs/                 Pläne, Protokoll-Referenzen, Runbook
```

## Start

- **SaaS-Client (Dev):** `pnpm --filter @infinite-matrix/client-web dev` → `http://localhost:5173`
- **Standalone-Preview:** Browser direkt auf `packages/client-standalone/matrix.html` zeigen lassen, oder via lokalem HTTP-Server.
- **Bridge (Dev):** `pnpm --filter @infinite-matrix/bridge dev`

Deployment läuft via GitHub-Actions (`.github/workflows/deploy.yml`):
- `https://matrix.levcon.at/` → Standalone (Legacy-Pfad, bleibt bis SaaS Live geht)
- `https://matrix.levcon.at/standalone/` → Standalone (neuer permanenter Pfad)
- `https://matrix.levcon.at/api/` → Supabase
- `https://matrix.levcon.at/ws` + `/mcp` → Bridge

## Hintergrund

- Konzept & Prinzipien: [CLAUDE.md](CLAUDE.md)
- Backend-Phase-0-Plan: [docs/plan-backend-phase-0.md](docs/plan-backend-phase-0.md)
- Bridge-Plan: [docs/plan-bridge.md](docs/plan-bridge.md)
- Offene Themen: [BACKLOG.md](BACKLOG.md)
