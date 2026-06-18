-- ── price_items: справочник цен ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS price_items (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  code       text,
  category   text,
  name       text NOT NULL,
  unit       text,
  price      numeric,
  price_vat  numeric,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS price_items_name_idx     ON price_items (name);
CREATE INDEX IF NOT EXISTS price_items_category_idx ON price_items (category);

-- ── specifications: список спецификаций ────────────────────────────────────
CREATE TABLE IF NOT EXISTS specifications (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  title         text NOT NULL,
  description   text,
  total_no_vat  numeric DEFAULT 0,
  total_vat     numeric DEFAULT 0,
  lines_count   int     DEFAULT 0,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

-- ── spec_lines: строки спецификации ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS spec_lines (
  id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  spec_id        uuid NOT NULL REFERENCES specifications(id) ON DELETE CASCADE,
  price_item_id  uuid REFERENCES price_items(id) ON DELETE SET NULL,
  name           text NOT NULL,
  unit           text,
  qty            numeric DEFAULT 1,
  price          numeric,
  price_vat      numeric,
  sum            numeric DEFAULT 0,
  sum_vat        numeric DEFAULT 0,
  position       int     DEFAULT 0,
  created_at     timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS spec_lines_spec_id_idx ON spec_lines (spec_id);

-- ── Row Level Security ─────────────────────────────────────────────────────
-- Включите RLS и добавьте политику публичного доступа для anon-ключа.
-- В Supabase Dashboard: Authentication → Policies → Enable RLS + Add Policy.

ALTER TABLE price_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE specifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE spec_lines     ENABLE ROW LEVEL SECURITY;

-- Политики (разрешают всё для anon и authenticated):
DROP POLICY IF EXISTS "allow_all" ON price_items;
DROP POLICY IF EXISTS "allow_all" ON specifications;
DROP POLICY IF EXISTS "allow_all" ON spec_lines;

CREATE POLICY "allow_all" ON price_items    FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON specifications FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON spec_lines     FOR ALL USING (true) WITH CHECK (true);
