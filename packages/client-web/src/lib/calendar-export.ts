// Calendar-Export (V1).
//
// Generiert RFC-5545-konforme ICS-Datei aus den calendar-kind atom_
// manifestations eines Workspaces. User kann die Datei herunterladen
// und in Outlook/Google Calendar/Apple Calendar als statische .ics
// importieren.
//
// V2 wird einen Live-Subscription-Feed bauen (eigener Node-Service
// auf einer separaten Sub-Domain wie ics.matrix.levcon.at — Supabase
// REST kann text/calendar nicht returnen). Bis dahin reicht der
// statische Export — User aktualisiert per neuem Download.

import { supabase } from './supabase';

type IcsEvent = {
  uid: string;
  summary: string;
  description?: string;
  start: Date;
  end: Date;
  allDay: boolean;
  url?: string;
  rrule?: string; // RFC-5545 RRULE-String
};

function escapeIcsText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

function formatIcsDate(d: Date, allDay: boolean): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  if (allDay) {
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
  }
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

function buildIcs(events: IcsEvent[], calendarName: string): string {
  const lines: string[] = [];
  lines.push('BEGIN:VCALENDAR');
  lines.push('VERSION:2.0');
  lines.push('PRODID:-//Matrix//Calendar Export 1.0//DE');
  lines.push('CALSCALE:GREGORIAN');
  lines.push('METHOD:PUBLISH');
  lines.push(`X-WR-CALNAME:${escapeIcsText(calendarName)}`);

  for (const ev of events) {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${ev.uid}@matrix.levcon.at`);
    lines.push(`DTSTAMP:${formatIcsDate(new Date(), false)}`);
    if (ev.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${formatIcsDate(ev.start, true)}`);
      lines.push(`DTEND;VALUE=DATE:${formatIcsDate(ev.end, true)}`);
    } else {
      lines.push(`DTSTART:${formatIcsDate(ev.start, false)}`);
      lines.push(`DTEND:${formatIcsDate(ev.end, false)}`);
    }
    lines.push(`SUMMARY:${escapeIcsText(ev.summary)}`);
    if (ev.description) {
      lines.push(`DESCRIPTION:${escapeIcsText(ev.description)}`);
    }
    if (ev.url) {
      lines.push(`URL:${ev.url}`);
    }
    if (ev.rrule) {
      lines.push(`RRULE:${ev.rrule}`);
    }
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  // RFC-5545 verlangt CRLF; viele Reader sind tolerant, aber wir
  // halten uns daran.
  return `${lines.join('\r\n')}\r\n`;
}

// RecurRule → ICS RRULE-Konversion (subset).
function recurToRrule(recur: {
  type?: string;
  interval?: number;
  endType?: string;
  endDate?: string;
  endCount?: number;
}): string | undefined {
  if (!recur || !recur.type || recur.type === 'none') return undefined;
  const freqMap: Record<string, string> = {
    daily: 'DAILY',
    weekly: 'WEEKLY',
    monthly: 'MONTHLY',
    yearly: 'YEARLY',
  };
  const freq = freqMap[recur.type];
  if (!freq) return undefined;
  let rule = `FREQ=${freq}`;
  if (recur.interval && recur.interval > 1) rule += `;INTERVAL=${recur.interval}`;
  if (recur.endType === 'count' && recur.endCount && recur.endCount > 0) {
    rule += `;COUNT=${recur.endCount}`;
  } else if (recur.endType === 'date' && recur.endDate) {
    const d = new Date(recur.endDate);
    rule += `;UNTIL=${formatIcsDate(d, false)}`;
  }
  return rule;
}

export type CalendarExportOptions = {
  workspaceId: string;
  workspaceName: string;
};

export async function exportWorkspaceCalendarIcs(
  opts: CalendarExportOptions,
): Promise<{ filename: string; content: string }> {
  // Lade alle Calendar-kind atom_manifestations + Tasks mit deadline.
  // RLS schraenkt auf workspace-member ein — kein zusaetzlicher Filter.
  const { data: manifs, error: mErr } = await supabase
    .from('atom_manifestations')
    .select('id, atom_type, atom_id, kind, display_meta')
    .eq('workspace_id', opts.workspaceId)
    .eq('kind', 'calendar');
  if (mErr) throw mErr;

  const { data: tasks, error: tErr } = await supabase
    .from('tasks')
    .select('id, label, note, deadline, recur')
    .eq('workspace_id', opts.workspaceId)
    .not('deadline', 'is', null);
  if (tErr) throw tErr;

  const events: IcsEvent[] = [];

  // Manifestations sind die Quelle der Wahrheit fuer Calendar-Termine
  // (display_meta haelt Datum/Range/Recur/Uhrzeit).
  for (const m of manifs ?? []) {
    const meta = (m.display_meta as Record<string, unknown>) ?? {};
    const dateStr = meta.date as string | undefined;
    const endStr = meta.end_date as string | undefined;
    const time = meta.time as string | undefined;
    const label = (meta.label as string | undefined) ?? '(ohne Titel)';
    if (!dateStr) continue;

    const startDate = new Date(`${dateStr}T${time || '00:00:00'}Z`);
    const endDate = endStr
      ? new Date(`${endStr}T${time || '00:00:00'}Z`)
      : new Date(startDate.getTime() + (time ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000));
    const allDay = !time;

    events.push({
      uid: m.id as string,
      summary: label,
      description: (meta.note as string | undefined) ?? undefined,
      start: startDate,
      end: endDate,
      allDay,
      rrule: recurToRrule((meta.recur as Record<string, unknown>) ?? {}),
    });
  }

  // Tasks ohne Calendar-Manifestation: deadline als allDay-Event.
  const manifAtomIds = new Set(
    (manifs ?? []).filter((m) => m.atom_type === 'task').map((m) => m.atom_id as string),
  );
  for (const t of tasks ?? []) {
    if (manifAtomIds.has(t.id as string)) continue;
    if (!t.deadline) continue;
    const d = new Date(`${t.deadline}T00:00:00Z`);
    const end = new Date(d.getTime() + 24 * 60 * 60 * 1000);
    events.push({
      uid: `task-${t.id}`,
      summary: (t.label as string) ?? '(ohne Titel)',
      description: (t.note as string | undefined) ?? undefined,
      start: d,
      end,
      allDay: true,
      rrule: recurToRrule((t.recur as Record<string, unknown>) ?? {}),
    });
  }

  return {
    filename: `${opts.workspaceName.replace(/[^a-z0-9-]/gi, '_')}.ics`,
    content: buildIcs(events, opts.workspaceName),
  };
}

// Helper: Browser-Download triggern.
export function downloadIcs(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 0);
}
