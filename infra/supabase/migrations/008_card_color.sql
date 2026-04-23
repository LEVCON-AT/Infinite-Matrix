-- ═══════════════════════════════════════════════════════════════
-- Phase 0f — Card-Farbe
--
-- Karten bekommen eine optionale Farbe analog zu kb_cols.color.
-- Rendering im Client: border-top: 3px solid var(--kb-card-color),
-- genauso wie bei Spalten — visuelle Parität, kein Konflikt mit
-- der border-left-Priority-Markierung.
--
-- Speicherform: CSS-Variable-Referenz als String (z.B. 'var(--red)')
-- oder NULL. Gleiche Konvention wie bei kb_cols.color — der Client
-- setzt die Werte aus einer festen Palette.
--
-- Idempotent.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.kb_cards
  ADD COLUMN IF NOT EXISTS color text;
