# Edge-Functions (self-hosted)

Deno-based Edge-Functions, Pendant zu Supabase-Cloud-Functions.
Runtime: `supabase/edge-runtime` Docker-Image (siehe `docker-compose.yml`,
Service `functions`).

## Wann eine Edge-Function statt einer RPC?

Eine RPC (SECURITY DEFINER plpgsql in `migrations/`) reicht fast immer:
sie laeuft im DB-Prozess, hat direkten SQL-Zugang und cuesteresst durch
GRANT EXECUTE den `authenticated`-Rollen-Scope. Edge-Functions sind
**nur** noetig wenn:

- service-role-API-Zugriff gebraucht wird (z.B. `auth.admin.deleteUser`,
  Storage-Bucket-Admin-Operationen) — die laufen nicht in der DB.
- ein externer Service angerufen werden muss (Webhook, Mail, externe
  API) und das Geheim-Token nicht ins Frontend gehoeren darf.
- Cron-artige Tasks (allerdings dann besser via pg_cron-Extension wenn
  rein DB-internal).

Bei Zweifel: zuerst RPC. Edge-Function erst wenn RPC nachweislich nicht
geht.

## Architektur

`main/index.ts` ist der **Dispatcher** — der Edge-Runtime startet ihn
als single entry-point, er routet auf die anderen Functions per
URL-Pfad. So koennen wir mehrere Functions pro Container betreiben
ohne pro Function einen Container hochzufahren.

Pro Function ein eigenes Verzeichnis mit `index.ts` (Default-Export ist
ein `Deno.serve`-Handler). Der Dispatcher lazy-imported sie.

Aufruf vom Client (siehe `packages/client-web/src/lib/edge-functions.ts`):

```ts
const { data, error } = await callEdgeFunction('delete-self-account', {
  confirmEmail: u.email,
});
```

Routing geht ueber Kong: `/functions/v1/<name>` → `functions:9000/<name>`.
Kong forced `key-auth` + `acl` (anon/admin), genau wie der REST/Auth-
Endpoint — d.h. der Client schickt den `apikey`-Header automatisch.

## Deploy (manuell beim ersten Setup)

Nach Mergen einer neuen Function oder Aenderung am `docker-compose.yml`
ist eine VPS-Aktion noetig — die normale `Apply DB migrations`-Pipeline
restartet die Compose-Services nicht.

```bash
ssh root@<VPS>
cd /opt/matrix-repo/infra/supabase
docker compose up -d functions  # nur wenn neu / image-Aenderung
docker compose exec functions sh -c 'ls /home/deno/functions'  # Sanity-Check
docker compose exec kong kong reload  # bei kong.yml-Aenderung
```

Spaeter waere ein Deploy-Step in `.github/workflows/deploy.yml`
sinnvoll, der auf Aenderungen unter `infra/supabase/functions/**`
triggert + `docker compose exec functions kill -HUP 1` (Hot-Reload)
schickt. V1 manuell, bis ein konkreter Bedarf der Auto-Pipeline
auftritt.

## Aktuell vorhandene Functions

- `main/` — Dispatcher.
- `delete-self-account/` — Welle D.4. Loescht den eigenen Account via
  service-role. AAL2-Step-Up im Frontend erforderlich, der Server
  prueft das via JWT-Claims zusaetzlich.
