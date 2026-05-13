// CORS-Header-Helpers fuer Edge-Functions.
//
// Kong haengt seinen eigenen CORS-Plugin bereits an die Function-Route
// (`plugins: [name: cors]` in kong.yml). Diese Helpers sind nur fuer
// den Fall dass eine Function direkt aufgerufen wird (Tests, lokales
// Dev) ODER fuer den Preflight, den Kong manchmal nicht selbst handelt.

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      ...corsHeaders,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
}

export function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, { status });
}
