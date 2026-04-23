-- ============================================
-- pkizip 조직 관리자 페이지 확장 마이그레이션
-- 2026-04-23
-- ============================================
-- 공용 주소록(tenant_address_book) + RLS + grants

BEGIN;

CREATE TABLE IF NOT EXISTS tenant_address_book (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN ('member','partner','custom')),
  display_name text NOT NULL,
  email text,
  organization text,
  job_title text,
  phone text,
  notes text,
  tags text[] DEFAULT '{}',
  fingerprint text,
  cert_classic text,
  cert_kem text,
  cert_dsa text,
  enc_jwk_classic jsonb,
  logotype text,
  linked_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  source text DEFAULT 'manual' CHECK (source IN ('manual','imported','linked_user')),
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_addr_tenant_category ON tenant_address_book(tenant_id, category);
CREATE INDEX IF NOT EXISTS idx_addr_tenant_name ON tenant_address_book(tenant_id, display_name);
CREATE INDEX IF NOT EXISTS idx_addr_tenant_fp ON tenant_address_book(tenant_id, fingerprint);

ALTER TABLE tenant_address_book ENABLE ROW LEVEL SECURITY;

-- 정책 (idempotent)
DROP POLICY IF EXISTS "addr_select" ON tenant_address_book;
DROP POLICY IF EXISTS "addr_insert" ON tenant_address_book;
DROP POLICY IF EXISTS "addr_update" ON tenant_address_book;
DROP POLICY IF EXISTS "addr_delete" ON tenant_address_book;

CREATE POLICY "addr_select" ON tenant_address_book FOR SELECT
  USING (public.is_tenant_member(tenant_id) OR public.is_system_admin());
CREATE POLICY "addr_insert" ON tenant_address_book FOR INSERT
  WITH CHECK (public.is_tenant_admin(tenant_id));
CREATE POLICY "addr_update" ON tenant_address_book FOR UPDATE
  USING (public.is_tenant_admin(tenant_id))
  WITH CHECK (public.is_tenant_admin(tenant_id));
CREATE POLICY "addr_delete" ON tenant_address_book FOR DELETE
  USING (public.is_tenant_admin(tenant_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_address_book TO authenticated;

COMMIT;
