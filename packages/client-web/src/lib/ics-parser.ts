// Minimaler RFC-5545-Parser fuer den ICS-Upload-Pfad (Welle I.6).
//
// Deckt VEVENT-Bloecke ab: SUMMARY, DESCRIPTION, LOCATION, URL, UID,
// DTSTART, DTEND, RRULE, RECURRENCE-ID. Faltet RFC-5545-Line-Continuations
// (Spaces am Anfang einer Zeile = Fortsetzung der vorigen Zeile).
//
// Nicht abgedeckt (deferred V2 falls noetig):
//   - VTIMEZONE-Bloecke (Konvertierung Lokal → UTC). DTSTART mit
//     TZID-Param wird als naive Datetime im lokalen Browser-TZ
//     interpretiert.
//   - EXDATE / EXRULE.
//   - VALARM, VTODO, VJOURNAL.
//   - Escape-Sequenzen jenseits von \\, \n, \,.
//
// Alle nicht abgedeckten Faelle koennen vom User durch einen direkten
// ICS-Subscribe (Pull-URL) bzw. spaeter Google/MS-OAuth umgangen werden.

import type { ParsedEventInput } from './calendar-inbound';

export function parseIcs(text: string): ParsedEventInput[] {
  const unfolded = unfold(text);
  const events: ParsedEventInput[] = [];
  let cur: Partial<ParsedEventInput> | null = null;
  let inEvent = false;

  for (const line of unfolded.split(/\r?\n/)) {
    if (line === 'BEGIN:VEVENT') {
      cur = {};
      inEvent = true;
      continue;
    }
    if (line === 'END:VEVENT') {
      if (inEvent && cur && cur.start_at && cur.summary) {
        events.push({
          summary: cur.summary,
          description: cur.description ?? null,
          location: cur.location ?? null,
          url: cur.url ?? null,
          external_id: cur.external_id,
          start_at: cur.start_at,
          end_at: cur.end_at ?? null,
          all_day: cur.all_day ?? false,
          rrule: cur.rrule ?? null,
          recurrence_id: cur.recurrence_id ?? null,
        });
      }
      cur = null;
      inEvent = false;
      continue;
    }
    if (!inEvent || !cur) continue;

    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const namePart = line.slice(0, idx);
    const value = line.slice(idx + 1);
    const [name, ...paramParts] = namePart.split(';');
    const params = new Map<string, string>();
    for (const p of paramParts) {
      const eq = p.indexOf('=');
      if (eq > 0) params.set(p.slice(0, eq).toUpperCase(), p.slice(eq + 1));
    }

    switch (name) {
      case 'UID':
        cur.external_id = value;
        break;
      case 'SUMMARY':
        cur.summary = unescapeIcs(value);
        break;
      case 'DESCRIPTION':
        cur.description = unescapeIcs(value);
        break;
      case 'LOCATION':
        cur.location = unescapeIcs(value);
        break;
      case 'URL':
        cur.url = value;
        break;
      case 'DTSTART': {
        const parsed = parseDateValue(value, params);
        cur.start_at = parsed.iso;
        cur.all_day = parsed.allDay;
        break;
      }
      case 'DTEND': {
        const parsed = parseDateValue(value, params);
        cur.end_at = parsed.iso;
        break;
      }
      case 'RRULE':
        cur.rrule = value;
        break;
      case 'RECURRENCE-ID':
        cur.recurrence_id = value;
        break;
      default:
        break;
    }
  }

  return events;
}

// RFC-5545 §3.1: Lines folded with leading whitespace.
function unfold(text: string): string {
  return text.replace(/\r?\n[ \t]/g, '');
}

// SUMMARY, DESCRIPTION, LOCATION nutzen escaped commas/semicolons/newlines.
function unescapeIcs(s: string): string {
  return s
    .replace(/\\\\/g, '\\')
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';');
}

// VALUE=DATE → all-day (YYYYMMDD).
// VALUE=DATE-TIME → wahlweise UTC (suffix Z) oder local (TZID-Param).
function parseDateValue(
  value: string,
  params: Map<string, string>,
): { iso: string; allDay: boolean } {
  const valueType = (params.get('VALUE') ?? '').toUpperCase();
  // YYYYMMDD
  if (valueType === 'DATE' || /^\d{8}$/.test(value)) {
    const y = value.slice(0, 4);
    const m = value.slice(4, 6);
    const d = value.slice(6, 8);
    return {
      iso: new Date(`${y}-${m}-${d}T00:00:00Z`).toISOString(),
      allDay: true,
    };
  }
  // YYYYMMDDTHHMMSS[Z]
  const m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (m) {
    const [, y, mo, d, hh, mm, ss, z] = m;
    const iso =
      z === 'Z'
        ? `${y}-${mo}-${d}T${hh}:${mm}:${ss}Z`
        : `${y}-${mo}-${d}T${hh}:${mm}:${ss}`;
    return {
      iso: new Date(iso).toISOString(),
      allDay: false,
    };
  }
  // Fallback — best-effort.
  return { iso: new Date(value).toISOString(), allDay: false };
}
