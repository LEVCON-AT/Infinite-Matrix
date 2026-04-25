# Service-Role-Key Rotation Runbook

**Status:** Stub — Inhalt kommt mit P1.0b.

## Geplanter Inhalt (P1.0b)

- Trigger-Liste: alle 90d Routine, sofort bei Verdacht (Backup-Leak, Mitarbeiter-Abgang, Endpoint-Compromise).
- Schritt-für-Schritt: Supabase-CLI generiert neuen JWT → atomarer Re-Load der Bridge via systemd `LoadCredential`-Pattern → Bitwarden-Update → alter Key in Supabase-Studio invalidieren.
- Verifikation: alter Key → 401, neuer Key → 200, kein Down-Sekunde im `journalctl -u matrix-bridge`.
- Rollback bei Fehler: alter Key bleibt 5 Min lang gültig (Supabase-Default), in der Zeit ist Re-Switch via `mv .env.new .env.old` möglich.

## Pointer

- Skript wird `infra/scripts/rotate-service-role-key.sh` (nicht `infra/recovery/`, weil operativ kein Recovery).
- systemd-Anpassung in `infra/systemd/matrix-bridge.service` — `EnvironmentFile=` → `LoadCredential=`.
- Bridge-Anpassung in `packages/bridge/src/config.ts` — Read aus `/run/credentials/matrix-bridge.service/SUPABASE_SERVICE_ROLE_KEY` mit ENV-Var-Fallback.
