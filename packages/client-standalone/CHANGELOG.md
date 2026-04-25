# Standalone Client — Changelog

## Status

**Eingefroren bei v0.3.0-checklist-v2** (Phase 4 Bridge + V2 Checklisten).

Der Standalone-Client (`matrix.html`) ist die Single-File-HTML-Variante
des Infinite-Matrix-Tools. Er bleibt als Fallback / Offline-First-Build
erhalten: localStorage als Primaerspeicher, optional File System Access
API mit Auto-Save, AES-GCM/PBKDF2-Verschluesselung fuer `.imx`-Exports.

**Keine Weiterentwicklung.** Bugfixes nur, wenn kritisch (Datenverlust,
Security). Neue Features wandern in den SaaS-Client
(`packages/client-web`).

## Round-Trip mit dem SaaS-Client

Der SaaS-Client (Phase 0g.2) liest und schreibt `.imx`/`.json`-Exports
mit identischen Crypto-Parametern (AES-GCM-256, PBKDF2 100k Iterations,
IV 12 B, Salt 16 B). Daten lassen sich daher beliebig zwischen
Standalone und SaaS migrieren.

## Deployment

- Pfad auf dem VPS: `/var/www/matrix/standalone/matrix.html`
- URL: `https://matrix.levcon.at/standalone/`
- nginx: `infra/nginx/matrix.conf`, location `/standalone/`
- CI: `.github/workflows/deploy.yml`, Step "Deploy standalone"

## Versionen

### v0.3.0-checklist-v2 (frozen)

Letzter Stand vor dem Standalone-Freeze. Vollstaendige Feature-Liste
liegt im Source (`<title>` + Header-Kommentar in `matrix.html`).

Zusammenfassung:
- Rekursive Matrix-Struktur (Sub-Matrizen, Sub-Boards)
- Cell-Features: Info, Aufgaben (Kanban), Checklisten
- Checklisten V2: Nesting, Alias-Autocomplete, Paste, Recur, History,
  Events, Transform-to-Card
- AI-Bridge (WebSocket + MCP) gegen self-hosted VPS
- IMX-Export/Import (verschluesselt, `.imx`)
- Sidebar-Tree mit Frequenzmatrix + Aufgabenuebersicht

Aeltere Versionen sind in der Repo-History (`git log client/matrix_tool_beta.html` vor dem Move).
