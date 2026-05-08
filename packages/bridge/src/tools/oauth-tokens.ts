// Welle WV.D.8 Heptad-Pflege — MCP-Tools fuer user_oauth_tokens.
//
// User-private OAuth-Tokens. Sensible Daten, deshalb sehr enge AI-API:
//   - oauth_token.list: Liefert nur Status (provider + connected/expired
//     + scopes_granted + last_refreshed_at). KEIN access_token, KEIN
//     refresh_token, KEINE generic_credentials.
//   - oauth_token.disconnect: Loescht den Token fuer einen Provider.
//
// Connect-Flow ist NICHT MCP-faehig — OAuth braucht Browser-Redirect
// vom User. Das macht das Frontend in `lib/oauth-flow.ts`.

import { z } from 'zod';
import type { ToolDef } from '../dispatcher.js';
import { zodToJsonSchema } from '../util/zod-json.js';

const channelProviderSchema = z.enum([
  'outlook',
  'gmail',
  'mail-generic',
  'onenote',
  'onedrive',
  'drive',
  'dropbox',
  'nextcloud',
  'slack',
  'teams',
  'discord',
  'telegram',
  'whatsapp',
]);

// ─── oauth_token.list ────────────────────────────────────────────
const oauthTokenListSchema = z.object({
  provider: channelProviderSchema
    .optional()
    .describe('Filter auf Provider. Ohne: alle verbundenen Provider'),
});

// ─── oauth_token.disconnect ──────────────────────────────────────
const oauthTokenDisconnectSchema = z.object({
  provider: channelProviderSchema.describe('Provider dessen Token geloescht wird'),
});

export const oauthTokenTools: ToolDef[] = [
  {
    name: 'oauth_token.list',
    description:
      'Listet die OAuth-Verbindungen des aktuellen Users (nur Status, kein Token). Liefert pro verbundenem Provider: provider, status (valid/expired/missing), scopes_granted, expires_at, last_refreshed_at.',
    schema: oauthTokenListSchema,
    jsonSchema: zodToJsonSchema(oauthTokenListSchema),
  },
  {
    name: 'oauth_token.disconnect',
    description:
      'Trennt die OAuth-Verbindung fuer einen Provider. Verknuepfte Widgets fallen auf native/off-Modus zurueck. Connect-Flow muss interaktiv ueber das Frontend laufen — kann nicht via AI gestartet werden.',
    schema: oauthTokenDisconnectSchema,
    jsonSchema: zodToJsonSchema(oauthTokenDisconnectSchema),
  },
];
