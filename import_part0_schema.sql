-- === Запустить в Supabase SQL Editor ===

CREATE TABLE IF NOT EXISTS catalogs (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name        text NOT NULL,
  created_at  timestamptz DEFAULT now()
);
ALTER TABLE catalogs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all" ON catalogs;
CREATE POLICY "allow_all" ON catalogs FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE price_items ADD COLUMN IF NOT EXISTS catalog_id uuid REFERENCES catalogs(id) ON DELETE SET NULL;

INSERT INTO catalogs (id, name) VALUES ('a1b2c3d4-0000-0000-0000-000000000001', 'Справочник ЦП') ON CONFLICT DO NOTHING;
UPDATE price_items SET catalog_id = 'a1b2c3d4-0000-0000-0000-000000000001' WHERE catalog_id IS NULL;

INSERT INTO catalogs (id, name) VALUES ('b2c3d4e5-0000-0000-0000-000000000002', 'ПСД 546/1 — Туристическая база') ON CONFLICT DO NOTHING;
