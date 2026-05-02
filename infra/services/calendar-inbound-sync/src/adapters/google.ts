// Google-Calendar-Adapter (Welle I.10 — V1 Stub).
//
// V1 wirft 'not_implemented'. I.10 implementiert events.list mit
// syncToken + OAuth-Refresh + Watch-Channel-Setup.

import type { ParsedEvent, SyncResult } from '../types.js';

export type GoogleAdapterArgs = {
  oauth_token: string | null;
  oauth_refresh_token: string | null;
  oauth_expires_at: string | null;
  sync_token: string | null;
};

export async function syncGoogle(_args: GoogleAdapterArgs): Promise<{
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
      error: 'google_adapter_not_implemented',
    },
    events: [],
    externalIds: [],
  };
}
