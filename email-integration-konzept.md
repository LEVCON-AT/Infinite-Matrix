# E-Mail/Outlook → Matrix: Integrationskonzept

## Ausgangslage
- Die App läuft als lokale HTML-Datei (kein Server, kein Backend)
- Persistenz: File System Access API (JSON-Datei) + localStorage
- Outlook ist die Kalender/Mail-Quelle
- Ziel: Wiederkehrende Outlook-Termine sollen automatisch als Aufgaben in der Matrix landen
- Kürzel-System (`^alias`) existiert bereits für interne Navigation

## Das Kernproblem
Eine lokale HTML-Datei kann keine E-Mails empfangen. Es braucht eine **Middleware** zwischen Outlook und der App.

---

## Architektur-Optionen

### Option A: Power Automate + OneDrive JSON (Empfohlen für Outlook 365)

```
Outlook Termin/Mail
    ↓ (Power Automate Flow)
    ↓ Trigger: "Wenn E-Mail an matrix@firma.de eingeht"
    ↓ Aktion: Parse Betreff/Body → Kürzel extrahieren
    ↓ Aktion: JSON an OneDrive-Datei anhängen
    ↓
OneDrive: inbox.json
    ↓ (App liest beim Öffnen / per Button)
    ↓ File System Access API oder manueller Import
    ↓
Matrix Tool → Inbox → Routing via Kürzel
```

**Vorteile**: Kein eigener Server, nutzt Microsoft-Infrastruktur, kostenlos in M365
**Nachteile**: Braucht Power Automate Lizenz (in M365 Business oft enthalten)

### Option B: Supabase Edge Function als Webhook

```
Outlook Regel: "Weiterleitung an webhook@supabase.co"
    ↓
Supabase Edge Function
    ↓ Parst E-Mail (Betreff, Body, Anhänge)
    ↓ Extrahiert Kürzel aus Betreff: "[^proj] Wochenbericht"
    ↓ Speichert in Supabase DB: inbox-Tabelle
    ↓
Matrix Tool
    ↓ Fetch von Supabase REST API
    ↓ Zeigt Inbox an → User routet manuell oder auto via Kürzel
```

**Vorteile**: Echter Server, skalierbar, Supabase ist bereits als MCP verfügbar
**Nachteile**: Braucht E-Mail-Empfangsdienst (Mailgun/SendGrid Inbound Parse)

### Option C: Shared JSON File (Einfachste Variante)

```
User erstellt Outlook-Termin
    ↓ Kopiert Details manuell oder per Makro
    ↓ Fügt in eine lokale JSON-Datei ein (inbox.json)
    ↓
Matrix Tool
    ↓ Import-Button: "Inbox laden"
    ↓ Liest inbox.json → zeigt als Staging → User routet
```

**Vorteile**: Kein Server, kein Cloud-Dienst, funktioniert sofort
**Nachteile**: Manuell, kein Auto-Sync

### Option D: Outlook VBA/Add-In → Clipboard → App

```
Outlook VBA Makro / COM Add-In
    ↓ Liest Termin-Details
    ↓ Formatiert als JSON
    ↓ Kopiert in Clipboard
    ↓
Matrix Tool
    ↓ Ctrl+V → App parsed Clipboard-JSON
    ↓ Erstellt Aufgabe am richtigen Board via Kürzel
```

**Vorteile**: Sofortige Integration, kein Server
**Nachteile**: Clipboard-basiert, manueller Schritt

---

## Was in der App JETZT vorbereitet werden sollte

Unabhängig von der gewählten Option braucht die App diese Komponenten:

### 1. Inbox-Datenmodell

Neues globales Array `inbox`:
```js
let inbox = []; // persisted in JSON
// Jeder Eintrag:
{
  id: 'inbox_1',
  source: 'outlook',           // Herkunft
  subject: 'Wochenbericht',    // Betreff
  body: 'Details...',          // Nachrichtentext
  date: '2026-04-14',          // Datum des Termins
  recurrence: null,            // Outlook-Recurrence-Info (optional)
  alias: 'proj',               // Extrahiertes Kürzel (aus Betreff: [^proj])
  status: 'pending',           // pending | routed | dismissed
  routedTo: null,              // boardId wenn geroutet
  receivedAt: '2026-04-14T10:30:00Z'
}
```

### 2. Inbox-UI

- Neuer Bereich: "Eingang" — als Flyout/Panel oder als Tab
- Zeigt pending Items mit Betreff, Datum, extrahiertem Kürzel
- Aktionen pro Item:
  - **Auto-Route** (wenn Kürzel erkannt → sofort als Aufgabe auf dem Board anlegen)
  - **Manuell zuweisen** (Board-Picker)
  - **Verwerfen**

### 3. Import-Schnittstelle

Definiertes JSON-Schema für Inbox-Einträge:
```json
{
  "inboxItems": [
    {
      "subject": "Wochenbericht",
      "body": "Bitte bis Freitag",
      "date": "2026-04-18",
      "alias": "proj",
      "recurrence": {
        "type": "weekly",
        "weekdays": [4],
        "every": 1
      }
    }
  ]
}
```

Die App akzeptiert dieses Format über:
- File-Import (Button)
- Clipboard-Paste (Ctrl+V mit JSON-Detection)
- Zukünftig: Fetch von URL/API

### 4. E-Mail-Feld auf Boards

Jedes Board bekommt ein optionales `email`-Feld:
```js
nodes[id].email = 'matrix-proj@firma.de'
```
- Im Edit-Modus sichtbar neben dem Alias-Input
- Wird im JSON-Export mitgespeichert
- Power Automate/Webhook nutzt dieses Feld für Routing

### 5. Kürzel-Convention für E-Mail-Betreff

Standardformat: `[^kürzel] Betrefftext`
- Power Automate/VBA parst: RegEx `\[\^([a-z0-9]+)\]`
- Beispiel: `[^proj] Wochenbericht vorbereiten`
- Kürzel wird extrahiert → App routet zum Board `proj`

---

## Empfohlene Roadmap

### Phase 1: App-Vorbereitung (JETZT)
1. `inbox`-Array zum Datenmodell hinzufügen
2. Import-JSON-Schema definieren
3. Inbox-UI als Panel/Flyout
4. `email`-Feld auf Board-Nodes
5. Auto-Routing via Kürzel
6. Clipboard-Import (Ctrl+V JSON)

### Phase 2: Power Automate / Middleware (SPÄTER)
1. Shared Mailbox einrichten: `matrix@firma.de`
2. Power Automate Flow: E-Mail → JSON → OneDrive
3. App: OneDrive-Datei lesen (File System Access API)
4. Oder: Supabase Edge Function als Webhook

### Phase 3: Bi-direktionale Sync (OPTIONAL)
1. Aufgaben aus der App → Outlook-Termine erstellen
2. Status-Updates zurück an Outlook
3. Microsoft Graph API Integration

---

## Sofort umsetzbare Vorbereitung in der App

| Komponente | Aufwand | Beschreibung |
|-----------|---------|-------------|
| `inbox[]` Datenmodell | ~20 Zeilen | Neues Array, persistiert im JSON |
| `email`-Feld auf Boards | ~10 Zeilen | Optional, im Edit-Modus sichtbar |
| Import-Button (JSON) | ~30 Zeilen | Inbox-Items aus Datei laden |
| Clipboard-Paste | ~20 Zeilen | Ctrl+V erkennt JSON-Format |
| Inbox-Panel UI | ~80 Zeilen | Liste mit Auto-Route/Zuweisen/Verwerfen |
| Auto-Routing via Kürzel | ~20 Zeilen | `alias` aus Item → Board finden → Karte erstellen |

**Gesamt: ~180 Zeilen JS + ~40 Zeilen CSS**

---

## Offene Fragen

1. Soll die Inbox ein eigenes Panel sein (wie Minimap) oder ein Tab auf der Hauptseite?
2. Soll Auto-Routing sofort bei Import passieren oder manuell bestätigt werden?
3. Welche Outlook-Version nutzt du? (365/Exchange → Power Automate möglich, On-Premises → VBA/Add-In)
