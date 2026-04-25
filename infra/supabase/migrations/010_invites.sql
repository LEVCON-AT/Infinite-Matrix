-- ═══════════════════════════════════════════════════════════════
-- Phase 1 (P1.A) — Workspace-Invite-Flow: Tabelle + RLS + Grants
--
-- Single-Use-Tokens, TTL 7 Tage, hash-stored. Klartext-Token existiert
-- nur kurz beim Erzeugen (Mail-Link, Success-Modal) — in der DB liegt
-- ausschliesslich SHA-256(token). Lookup-Spalte (erste 8 byte des
-- Hashes, indiziert) macht das Auffinden in O(log n) ohne Klartext.
-- Vollvergleich gegen token_hash erfolgt mit timingSafeEqual auf
-- Application-Level (Bridge-RPC bzw. SECURITY DEFINER PL/pgSQL).
--
-- Diese Migration legt nur die Tabelle + Indices + RLS + Grants an.
-- Die Schreib-RPCs (create_invite / redeem_invite / revoke_invite)
-- brauchen die workspace_audit_log-Tabelle aus 011 und werden dort
-- gemeinsam definiert, damit beide Schemas im Moment der Function-
-- Definition existieren.
--
-- Idempotent: IF NOT EXISTS / DROP POLICY IF EXISTS / GRANT ist
-- re-runnable. CHECK-Constraints werden nur einmal angelegt;
-- Re-Add-Versuche scheitern ohne IF NOT EXISTS — daher in DO-Block
-- mit pg_constraint-Lookup gewrappt.
-- ═══════════════════════════════════════════════════════════════

-- ─── Tabelle workspace_invites ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.workspace_invites (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  token_hash           bytea NOT NULL,
  token_lookup         bytea NOT NULL,
  role                 public.workspace_role NOT NULL DEFAULT 'editor',
  invited_by           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  invited_email        text,
  expires_at           timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_at          timestamptz,
  accepted_by_user_id  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  revoked_at           timestamptz,
  revoked_by           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.workspace_invites IS
  'Phase 1 — Token-basierte Workspace-Einladungen. Single-Use, hash-stored, TTL 7d.';
COMMENT ON COLUMN public.workspace_invites.token_hash IS
  'SHA-256(raw_token) als bytea (32 byte). Klartext nie persistiert.';
COMMENT ON COLUMN public.workspace_invites.token_lookup IS
  'Erste 8 byte von token_hash, indiziert — schneller Lookup ohne Timing-Leak.';

-- CHECK-Constraints (idempotent via DO-Block + pg_constraint-Check).
DO $$
BEGIN
  -- Rolle: nur editor oder viewer per Invite (owner/admin nur via direkter Eintrag).
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'workspace_invites_role_check'
      AND conrelid = 'public.workspace_invites'::regclass
  ) THEN
    ALTER TABLE public.workspace_invites
      ADD CONSTRAINT workspace_invites_role_check
      CHECK (role IN ('editor','viewer'));
  END IF;

  -- accepted XOR revoked: ein Invite ist entweder offen, akzeptiert ODER widerrufen.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'workspace_invites_xor_state_check'
      AND conrelid = 'public.workspace_invites'::regclass
  ) THEN
    ALTER TABLE public.workspace_invites
      ADD CONSTRAINT workspace_invites_xor_state_check
      CHECK (accepted_at IS NULL OR revoked_at IS NULL);
  END IF;

  -- token_hash genau 32 byte (SHA-256), token_lookup genau 8 byte.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'workspace_invites_hash_size_check'
      AND conrelid = 'public.workspace_invites'::regclass
  ) THEN
    ALTER TABLE public.workspace_invites
      ADD CONSTRAINT workspace_invites_hash_size_check
      CHECK (octet_length(token_hash) = 32 AND octet_length(token_lookup) = 8);
  END IF;
END
$$;

-- ─── Indices ──────────────────────────────────────────────────
-- Workspace-Listing (Settings/Members-Page).
CREATE INDEX IF NOT EXISTS workspace_invites_workspace_idx
  ON public.workspace_invites(workspace_id);

-- Lookup beim Redeem: wir suchen ueber token_lookup (8 byte), nicht
-- ueber token_hash (32 byte). UNIQUE INDEX waere falsch, weil mit
-- 8 byte = 64 bit theoretische Kollision moeglich (selten, aber denkbar
-- wenn jemand Tokens massenhaft generiert). Plain Index reicht.
CREATE INDEX IF NOT EXISTS workspace_invites_token_lookup_idx
  ON public.workspace_invites(token_lookup);

-- Offene Invites pro Workspace (fuer Cleanup/Cron + UI-Listing).
-- Partial-Index spart Speicher: akzeptierte/widerrufene Invites sind
-- die Mehrheit nach einigen Wochen.
CREATE INDEX IF NOT EXISTS workspace_invites_open_idx
  ON public.workspace_invites(workspace_id, expires_at)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

-- ─── RLS aktivieren ───────────────────────────────────────────
ALTER TABLE public.workspace_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_invites FORCE ROW LEVEL SECURITY;

-- ─── Policies ─────────────────────────────────────────────────
-- Lese-Zugriff: nur owner/admin, fuer Settings/Members-Page-Listing.
-- Editor/Viewer brauchen die Liste nicht (sie sehen ja nur eigene
-- Membership). Pending-Invitee hat noch keine Session — der laeuft
-- ueber die SECURITY DEFINER RPC aus 011.
DROP POLICY IF EXISTS workspace_invites_select_admin ON public.workspace_invites;
CREATE POLICY workspace_invites_select_admin ON public.workspace_invites
  FOR SELECT USING (public.workspace_role_of(workspace_id) IN ('owner','admin'));

-- Schreiben (INSERT/UPDATE/DELETE) komplett gesperrt fuer alle API-Rollen.
-- create_invite / revoke_invite / redeem_invite laufen als
-- SECURITY DEFINER und bypassen RLS via Funktion-Owner. Direktes
-- INSERT mit anon/authenticated muss fail-loud sein, damit ein Bug
-- im Frontend nicht versehentlich Tokens streut.
DROP POLICY IF EXISTS workspace_invites_no_direct_write ON public.workspace_invites;
CREATE POLICY workspace_invites_no_direct_write ON public.workspace_invites
  FOR ALL USING (false) WITH CHECK (false);

-- ─── Grants ───────────────────────────────────────────────────
-- SELECT fuer authenticated (Policy filtert auf admin/owner).
-- service_role bekommt vollen Zugriff fuer Bridge-Restore-Pfade.
-- Direkte INSERT/UPDATE/DELETE-Grants gibt es bewusst nicht — der
-- Schreib-Pfad laeuft nur ueber RPCs.
GRANT SELECT ON public.workspace_invites TO authenticated;
GRANT ALL ON public.workspace_invites TO service_role;
