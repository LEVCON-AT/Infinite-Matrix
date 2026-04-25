# IONOS Cloud Console Recovery

Out-of-Band-Pfad zum VPS, wenn SSH komplett tot ist (Firewall-Selbstsperre, sshd-Crash, Disk-voll, Hostname-Probleme).

## Voraussetzungen

- IONOS-Cloud-Panel-Login: `https://login.ionos.de` (oder `https://my.ionos.de` für ältere Accounts).
- 2FA-App + Backup-Codes — beide offline gesichert (Bitwarden + Print).
- Rescue-User-Passwort (für VNC-Login nach Console-Auth).

Falls der IONOS-Account selbst kompromittiert ist: 2FA-Reset via Hotline, das ist Tagesarbeit. Phase-1.5 ergänzt einen Standby-VPS bei einem zweiten Provider mit DNS-Failover-Plan.

## Schritte

### 1. Cloud Console öffnen

1. Login auf `https://login.ionos.de` mit 2FA.
2. **Server & Cloud → Cloud Panel → Server**.
3. Auf den betroffenen Server klicken (`87.106.25.91` / `matrix.levcon.at`).
4. **Remote Console** öffnen (im linken Menü oder als Button im Server-Detail). Öffnet HTML5-VNC-Fenster — kein Java-Plugin nötig.

### 2. Login als rescue

Am VNC-Login-Prompt:

```
login: rescue
password: <aus Bitwarden>
```

Falls rescue-User noch nicht existiert (frischer Server oder Account-Kompromiss): GRUB-Single-User-Mode (siehe Abschnitt 4).

### 3. Standard-Fixes nach rescue-Login

```bash
# Service-Status prüfen
sudo systemctl status sshd nginx matrix-bridge fail2ban

# SSH wiederherstellen
sudo systemctl restart sshd
sudo journalctl -u sshd -n 50 --no-pager

# UFW prüfen + ggf. SSH freigeben
sudo ufw status verbose
sudo ufw allow 22/tcp

# Bridge wiederbeleben
sudo systemctl restart matrix-bridge
sudo journalctl -u matrix-bridge -n 50 --no-pager

# Supabase wiederbeleben
cd /opt/supabase && sudo docker compose ps
sudo docker compose up -d

# Disk voll? Aufräumen
df -h
sudo journalctl --vacuum-size=200M
sudo find /opt/recovery/snapshots -mtime +3 -delete   # nur wenn nötig
sudo docker system prune -af                            # entfernt unbenutzte Images/Volumes — VORSICHT, niemals während Restore!

# Recovery-Status
sudo /opt/recovery/scripts/status.sh
```

### 4. GRUB-Single-User-Mode (rescue-User existiert nicht / Passwort vergessen)

Nur als letzter Ausweg, wenn keine andere Anmeldung möglich ist.

1. Server **rebooten** (Cloud-Panel → Server → Power → Reboot, oder via VNC `sudo reboot`).
2. VNC-Fenster sofort offen lassen, beim Boot **Esc/Shift halten**, bis das GRUB-Menü erscheint.
3. Eintrag "Ubuntu" markieren, **`e`** drücken (Edit).
4. Zur Zeile mit `linux /boot/vmlinuz-...` runterscrollen. Am Ende der Zeile **`init=/bin/bash`** anhängen.
5. **Ctrl+X** oder **F10** zum Booten.
6. Nach Boot landest du als root in einer Bash ohne sshd, ohne network. Filesystem ist read-only mounted.
7. RW remounten: `mount -o remount,rw /`
8. Aktion durchführen, z.B.:
   - rescue-Passwort setzen: `passwd rescue`
   - rescue-User anlegen falls nicht da: `useradd -m -G sudo,adm rescue && passwd rescue`
   - SSH-authorized_keys reparieren: `nano /home/<user>/.ssh/authorized_keys`
9. Reboot: `exec /sbin/init` oder `mount -o remount,ro / && reboot -f`.
10. Normaler Login wieder möglich.

### 5. Filesystem korrupt / Boot fehlgeschlagen

Wenn Server gar nicht mehr bootet:

1. Cloud-Panel → Server → **Snapshot/Restore**.
2. Letztes IONOS-Snapshot auswählen (täglich, falls Setup-Schritt 7 aus README durch).
3. Restore starten — dauert 10-30 Min.
4. Nach Boot: SSH-Reconnect prüfen, dann `restore-postgres.sh` aus letztem `/opt/recovery/snapshots/`-Snapshot, weil das IONOS-Snapshot **whole-disk** ist und Postgres möglicherweise inkonsistent (RAM-State weg). Lokales Snapshot ist app-konsistent.

### 6. IONOS-Account selbst gesperrt / 2FA verloren

- 2FA-Backup-Codes (Print-Out + Bitwarden) probieren.
- Falls weg: IONOS-Hotline (Tel im Cloud-Panel-Footer), legitimieren mit Personalausweis.
- Tagesarbeit. Mitigation: Phase-1.5 etabliert externen Backup-Bucket bei zweitem Provider — dann unabhängig vom IONOS-Account.

## Wichtige URL- und Zugangs-Daten (NICHT in dieses Repo committen)

- IONOS-Login: in Bitwarden-Eintrag "IONOS Cloud Panel"
- rescue-Passwort: in Bitwarden-Eintrag "matrix.levcon.at rescue user"
- 2FA-Backup-Codes: Bitwarden + offline-Print im Tresor
- VNC-Console-URL: variiert pro Session, kein fester Link
