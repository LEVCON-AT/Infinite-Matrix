// Microsoft-Graph-Adapter (Welle I.11 — V1 Stub).
//
// V1 wirft 'not_implemented'. I.11 implementiert /me/calendarView/delta
// + OAuth-Refresh + Subscription-Setup.

import type { ParsedEvent, SyncResult } from '../types.js';

export type MicrosoftAdapterArgs = {
  oauth_token: string | null;
  oauth_refresh_token: string | null;
  oauth_expires_at: string | null;
  sync_token: string | null;
};

export async function syncMicrosoft(_args: MicrosoftAdapterArgs): Promise<{
  result: SyncResult;
  events: ParsedEvent[];
  externalIds: string[];
}> {
  return {
    result: {
      ok: false,
      inserted: 0,
      updated: 0,
      orphaned: 0,
      not_modified: false,
      error: 'microsoft_adapter_not_implemented',
    },
    events: [],
    externalIds: [],
  };
}
