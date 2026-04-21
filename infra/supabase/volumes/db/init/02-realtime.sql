-- _realtime-Schema fuer Supabase-Realtime-Service
-- Wird via ecto_migrate beim ersten Start vom Realtime-Container befuellt.

CREATE SCHEMA IF NOT EXISTS _realtime;
ALTER SCHEMA _realtime OWNER TO supabase_admin;

GRANT ALL ON SCHEMA _realtime TO supabase_admin;
