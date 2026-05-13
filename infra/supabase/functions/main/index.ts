// Main-Dispatcher fuer Edge-Functions.
//
// Self-hosted edge-runtime startet diese Function als single entry-point
// (siehe `docker-compose.yml` services.functions.command). Die Route
// `/<function-name>` wird hier auf das jeweilige Sub-Function-Modul
// gemappt und ausgefuehrt.
//
// Pattern: jede Sub-Function liefert einen Default-Export, der ein
// `(req: Request) => Promise<Response>` ist. Dispatcher lazy-imported
// die Module einmalig + cached.

import { corsHeaders, errorResponse } from '../_shared/cors.ts';

type Handler = (req: Request) => Response | Promise<Response>;

// Registry der bekannten Sub-Functions. Eintraege werden lazy geladen,
// damit ein Crash in einer Function nicht den Dispatcher mitreisst.
const REGISTRY: Record<string, () => Promise<{ default: Handler }>> = {
  'delete-self-account': () => import('../delete-self-account/index.ts'),
};

const handlerCache = new Map<string, Handler>();

async function resolveHandler(name: string): Promise<Handler | null> {
  if (handlerCache.has(name)) return handlerCache.get(name) ?? null;
  const loader = REGISTRY[name];
  if (!loader) return null;
  try {
    const mod = await loader();
    handlerCache.set(name, mod.default);
    return mod.default;
  } catch (err) {
    console.error(`[main] Failed to load function ${name}:`, err);
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  const url = new URL(req.url);
  // Kong strippt den `/functions/v1`-Prefix bereits (strip_path: true),
  // wir sehen hier nur den function-Namen + ggf. Sub-Pfad.
  const segments = url.pathname.split('/').filter(Boolean);
  const name = segments[0];
  if (!name) {
    return errorResponse('No function name in path', 400);
  }
  const handler = await resolveHandler(name);
  if (!handler) {
    return errorResponse(`Function not found: ${name}`, 404);
  }
  try {
    return await handler(req);
  } catch (err) {
    // Sub-Function darf eine Response werfen — das ist ein Force-Quit
    // Pattern fuer Auth-Failures etc.
    if (err instanceof Response) return err;
    console.error(`[main] Handler error in ${name}:`, err);
    return errorResponse('Internal function error', 500);
  }
});
