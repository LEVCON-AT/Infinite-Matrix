# Matrix VPS Recovery

Recovery-Skript-Suite für `matrix.levcon.at` / `staging.matrix.levcon.at` (IONOS-Cloud-Server, Ubuntu).

**Zweck:** Failsafe-Pfad ohne Off-VPS-Backup. Schützt vor SSH-Key-Loss, Bedien-Fehlern (`git clean -fd` im Deploy-Mirror), kaputten Migrationen, Postgres-Bugs.

**Off-VPS-Backup ist NICHT Teil dieses Setups** — kommt in Phase-1.5 (Hetzner Storage Box + age-encryption + restic).

## Layout

```
/opt/recovery/
├── scripts/        → Symlink auf /opt/matrix-repo/infra/recovery (versioniert im Repo)
│   ├── backup-now.sh
│   ├── restore-postgres.sh
│   ├── restore-volumes.sh
│   ├── lock-down.sh
│   ├── unlock.sh
│   ├── status.sh
│   ├── backup-cron.service
│   ├── backup-cron.timer
│   └── backup-failure-notify@.service
├── snapshots/      → /opt/recovery/snapshots/<UTC-iso>.tar.zst, 7 Tage Retention
└── state/          → temporäres Stage-Dir während Snapshot/Restore
/var/log/matrix-recovery/
└── matrix-recovery.log   → tee-Append + zusätzlich journal via logger
```

## Initial-Setup (User führt einmalig aus)

```bash
# 1. Rescue-User
sudo useradd -m -G sudo,adm rescue
sudo passwd rescue                       # Passwort aus: pwgen -s 32 1
                                         # → in Bitwarden ablegen + offline-Print

# 2. SSH 2-Faktor für rescue (publickey + password beide nötig)
sudo tee /etc/ssh/sshd_config.d/10-matrix.conf <<'EOF'
PasswordAuthentication no
PermitRootLogin no
KbdInteractiveAuthentication no

Match User rescue
    PasswordAuthentication yes
    AuthenticationMethods publickey password
    MaxAuthTries 3
EOF
sudo sshd -t && sudo systemctl restart sshd

# 3. sudoers — strict scope, nur Recovery-Skripte ohne Passwort
sudo tee /etc/sudoers.d/rescue-emergency <<'EOF'
rescue ALL=(root) NOPASSWD: /opt/recovery/scripts/backup-now.sh
rescue ALL=(root) NOPASSWD: /opt/recovery/scripts/status.sh
rescue ALL=(root) NOPASSWD: /opt/recovery/scripts/lock-down.sh
rescue ALL=(root) NOPASSWD: /opt/recovery/scripts/unlock.sh
rescue ALL=(root) NOPASSWD: /opt/recovery/scripts/restore-postgres.sh
rescue ALL=(root) NOPASSWD: /opt/recovery/scripts/restore-volumes.sh
rescue ALL=(root) NOPASSWD: /bin/journalctl, /bin/systemctl status *
rescue ALL=(root) NOPASSWD: /usr/bin/docker compose ps, /usr/bin/docker ps
rescue ALL=(root) NOPASSWD: /usr/sbin/ufw status
EOF
sudo visudo -c -f /etc/sudoers.d/rescue-emergency

# 4. /opt/recovery anlegen + Symlink
sudo mkdir -p /opt/recovery/{snapshots,state} /var/log/matrix-recovery
sudo chmod 0755 /opt/recovery /opt/recovery/snapshots /var/log/matrix-recovery
sudo chmod 0700 /opt/recovery/state
sudo chown -R root:root /opt/recovery /var/log/matrix-recovery
sudo ln -sfT /opt/matrix-repo/infra/recovery /opt/recovery/scripts

# 5. systemd-Units installieren + aktivieren
sudo cp /opt/matrix-repo/infra/recovery/backup-cron.{service,timer} /etc/systemd/system/
sudo cp /opt/matrix-repo/infra/recovery/backup-failure-notify@.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now backup-cron.timer

# 6. fail2ban-Whitelist Heim-IP gegen Selbst-Ban beim 2FA-Test
sudo nano /etc/fail2ban/jail.local
# unter [DEFAULT]:  ignoreip = 127.0.0.1/8 ::1 <heim-ip>
sudo systemctl restart fail2ban

# 7. IONOS-Snapshot im Cloud-Panel aktivieren (manuell, kein Skript)
#    https://login.ionos.de → Cloud Panel → Server <name> → Backups → Daily

# 8. Erster manueller Run
sudo systemctl start backup-cron.service
ls -lh /opt/recovery/snapshots/
sudo /opt/recovery/scripts/status.sh
```

## Verifikation

| # | Check | Befehl | Erwartung |
|---|---|---|---|
| 1 | 2-Faktor für rescue | `ssh -o PubkeyAuthentication=no rescue@vps` | beide Faktoren werden gefordert |
| 2 | Default-User OK | `ssh user@vps` mit Key | unverändert |
| 3 | Sudo-Scope blockiert | `rescue$ sudo /bin/bash` | NICHT erlaubt |
| 4 | Sudo-Scope erlaubt | `rescue$ sudo /opt/recovery/scripts/status.sh` | OK |
| 5 | Timer aktiv | `systemctl list-timers --all \| grep backup-cron` | `next` sichtbar |
| 6 | Erster Backup | `sudo /opt/recovery/scripts/backup-now.sh` + `ls /opt/recovery/snapshots/` | tar.zst > 1 MB |
| 7 | Test-Restore | `restore-postgres.sh <snap> --target=/tmp/test --confirm=YES-RESTORE-<ts>` | extrahiert OK |
| 8 | IONOS-Snapshot | Cloud-Panel | aktiv, letzter Run < 24h |
| 9 | Lock-Down-Drill | `lock-down.sh` + extern `curl https://staging.matrix...` | refused |
| 10 | Unlock | `unlock.sh` + `curl https://staging.matrix...` | OK |
| 11 | fail2ban-Whitelist | `fail2ban-client status sshd` | `Ignored: <heim-ip>` |
| 12 | mailx-Path optional | `echo test \| mailx -s test admin@levcon.at` | abgeschickt (oder skip wenn mailx fehlt) |

## Decision-Tree — was ist kaputt → welches Skript

| Symptom | Skript / Aktion |
|---|---|
| SSH zur Standard-User-IP geht nicht | rescue-Login via SSH (Passwort + Pubkey). Falls auch tot → IONOS-Console (siehe `ionos-console.md`). |
| Webseite tot, Bridge tot | `status.sh` zur Diagnose. Wenn Service down: `systemctl restart matrix-bridge` / `cd /opt/supabase && docker compose restart`. |
| Verdacht auf Angriff | `lock-down.sh` (Notbremse → nur SSH offen). Analyse via `journalctl`. Danach `unlock.sh`. |
| Postgres tot oder korrupt | `restore-postgres.sh /opt/recovery/snapshots/<latest>.tar.zst --confirm=YES-RESTORE-<ts>`. Vorher: `pre-restore`-Dump wird automatisch gezogen. |
| Storage-Volume korrupt | `restore-volumes.sh <snap> --what=storage --confirm=...`. |
| Bridge-SQLite korrupt | `restore-volumes.sh <snap> --what=bridge --confirm=...`. Service wird automatisch gestoppt + gestartet. |
| Disk voll | `status.sh` zur Übersicht. Snapshots aufräumen: `find /opt/recovery/snapshots -mtime +3 -delete`. journal ausmisten: `journalctl --vacuum-size=200M`. |
| Datei aus Backup einzeln gebraucht | Manuell: `zstd -d -c <snap.tar.zst> \| tar -xf -` ins Temp-Dir, einzelne Dateien greifen. |

## Edge-Cases / Bekannte Limits

- **Off-VPS-Lücke:** Wenn der ganze IONOS-Server tot ist (Hardware-Defekt, Account-Sperre), bringen die lokalen Snapshots nichts. Phase-1.5 schließt diese Lücke (Hetzner Storage Box + age + restic).
- **Storage-Volume:** der aktuelle docker-compose.yml hat keinen Storage-Service definiert (`infra/supabase/docker-compose.yml`). `volumes/storage/` existiert als Bind-Mount-Verzeichnis, ist aber bei den meisten Hosts leer. `backup-now.sh` skippt dann elegant mit `.MISSING`-Marker.
- **Bridge-SQLite:** im aktuellen Setup (Bridge auf VPS) liegt unter `/opt/matrix-bridge/data/matrix.db`. Wenn Bridge nicht installiert ist (lokale Dev-Maschine), skippt das Skript ebenfalls.
- **`pg_dump` aus laufendem Container:** verwendet `docker compose exec -T db`. Wenn der Container kurz nicht erreichbar ist, schlägt das Skript fehl — Retry beim nächsten Cron-Lauf 24h später. Manuell: `docker compose ps db` prüfen.
- **Pre-Restore-Dump:** `restore-postgres.sh` zieht IMMER vorher einen Sicherheits-Dump nach `/opt/recovery/state/pre-restore-<ts>.dump`. Bleibt liegen, bis manuell aufgeräumt — als Notfall-Rückspul-Punkt.

## Off-VPS-Backup (Phase-1.5)

Geplant für nach Abschluss Phase 1: Hetzner Storage Box + age-encryption + restic. Daily-Push der Snapshots, Retention 7 daily / 4 weekly / 12 monthly. Eigener Sub-Plan, eigener Sprint.
