# Rescue-Checkliste — "Was tun, wenn ..."

Quick-Reference für typische Notfälle. Vor Implementation: erst `status.sh`, dann gezielt diese Liste.

## SSH zum Standard-User geht nicht

1. `ssh rescue@vps` mit Passwort + Pubkey (2-Faktor) — falls das geht: Recovery via rescue.
2. Falls auch rescue tot: **IONOS Cloud Console** → siehe `ionos-console.md`.
3. In Console: `journalctl -u sshd -n 100` — was sagt das Log?
4. Standard-Fixes:
   ```bash
   sudo ufw allow 22/tcp
   sudo systemctl restart sshd
   sudo systemctl status fail2ban   # ist die Heim-IP gebannt?
   sudo fail2ban-client unban <heim-ip>
   ```

## Webseite tot (matrix.levcon.at / staging.matrix.levcon.at)

1. `sudo /opt/recovery/scripts/status.sh` — Health-Endpoints + Service-Status.
2. nginx tot? `sudo systemctl restart nginx`.
3. Bridge tot? `sudo systemctl restart matrix-bridge` + `sudo journalctl -u matrix-bridge -n 100`.
4. Supabase tot? `cd /opt/supabase && sudo docker compose ps && sudo docker compose up -d`.
5. SSL abgelaufen? `sudo certbot renew --dry-run` + bei Bedarf `sudo certbot renew`.

## Disk voll

1. `df -h` — wo ist der Druck?
2. `du -sh /var/log/* | sort -h` — Log-Riesen finden.
3. journal aufräumen: `sudo journalctl --vacuum-size=200M`.
4. Alte Snapshots: `find /opt/recovery/snapshots -mtime +3 -delete` (nur wenn ein neueres existiert!).
5. Docker-Images aufräumen: `sudo docker system prune -af` — **NIEMALS während Restore**, **NIEMALS wenn ein Container kurz vor Pull steht**.
6. Falls weiter eng: `sudo lsof | grep deleted` — gelöschte Files mit offenem Handle?

## Postgres tot oder korrupt

1. `cd /opt/supabase && sudo docker compose ps db` — Container-State.
2. Logs: `sudo docker compose logs -n 200 db`.
3. Healthcheck: `sudo docker compose exec db pg_isready -U postgres`.
4. Restart: `sudo docker compose restart db`.
5. Falls korrupt:
   ```bash
   ls -lt /opt/recovery/snapshots/   # neuester Snapshot
   sudo /opt/recovery/scripts/restore-postgres.sh \
     /opt/recovery/snapshots/<latest>.tar.zst \
     --confirm=YES-RESTORE-<ts>
   ```
6. Skript erstellt vorher automatisch einen `pre-restore-<ts>.dump` in `/opt/recovery/state/` — als Sicherheits-Anker.

## Bridge nicht erreichbar (`/healthz` 502/503)

1. `sudo systemctl status matrix-bridge` + `sudo journalctl -u matrix-bridge -n 100`.
2. Bridge läuft, aber 502 von nginx? → nginx-Upstream-Config prüfen: `sudo nginx -T | grep -A5 'matrix_bridge\|3849'`.
3. Bridge-Crash-Loop? Letzte Code-Änderung revertieren oder rebuild: `cd /opt/matrix-repo/packages/bridge && pnpm build && sudo cp -r dist /opt/matrix-bridge/ && sudo systemctl restart matrix-bridge`.
4. SQLite korrupt? `sudo sqlite3 /opt/matrix-bridge/data/matrix.db 'pragma integrity_check;'`. Bei Fehler: `restore-volumes.sh <snap> --what=bridge --confirm=...`.

## Verdacht auf Angriff

1. **Sofort:** `sudo /opt/recovery/scripts/lock-down.sh` — UFW dropt alles außer SSH.
2. Logs sichern: `sudo journalctl --since "1 hour ago" > /tmp/incident-$(date -u +%Y%m%dT%H%M%SZ).log`.
3. Auth-Logs: `sudo grep -E 'Failed|Invalid|Accepted' /var/log/auth.log | tail -100`.
4. Nginx-Access: `sudo tail -1000 /var/log/nginx/access.log | awk '{print $1}' | sort | uniq -c | sort -rn | head -10`.
5. Erst nach Analyse: `sudo /opt/recovery/scripts/unlock.sh`.
6. Service-Role-Key rotieren falls Backup-Leak vermutet: P1.0b-Skript `infra/scripts/rotate-service-role-key.sh`.

## Migration ist schiefgegangen

1. Was sagt die Migration? `sudo docker compose exec db psql -U postgres -c "\dt"` — Schema-Stand.
2. Falls schon partial applied: Forward-Fix als neue Migration. **Niemals bestehende Migration editieren**.
3. Daten verloren? `restore-postgres.sh` aus letztem Snapshot **VOR** der Migration.
4. CLAUDE.md Punkt: pro Sprint genau eine Migration, atomar in `BEGIN ... COMMIT;`. Bei Phase-1-Migrationen ist das Pflicht.

## IONOS-Account gesperrt

1. Bitwarden-Backup-Codes durchprobieren.
2. IONOS-Hotline anrufen, mit Ausweis legitimieren — Tagesarbeit.
3. **Mitigation:** Phase-1.5 etabliert Backup bei zweitem Provider (Hetzner) → unabhängig vom IONOS-Account-Status.

## Letzter Anker — alles ist tot, was tun?

1. **Lokale Repo-Kopie** (auf Dev-Maschine) ist die Source-of-Truth für den Code.
2. **Letztes Snapshot** liegt vermutlich im IONOS-Snapshot (Cloud-Panel) — Whole-Disk-Restore möglich.
3. **Lokale Snapshots** auf Dev-Maschine? Wenn `backup-now.sh`-Output mal manuell gepullt wurde: `scp rescue@vps:/opt/recovery/snapshots/<latest>.tar.zst .` — gilt nur retrospektiv.
4. Phase-1.5 schließt diese Lücke mit Off-VPS-Backup endgültig.
