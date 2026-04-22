-- ============================================
-- pkizip Multi-tenant Migration (B plan)
-- 2026-04-22
-- ============================================
-- Supabase SQL Editor에서 한 번에 실행 가능

BEGIN;

-- ───────────────────────────────────────────
-- 1. tenants.plan enum 확장
-- ───────────────────────────────────────────
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_plan_check;
ALTER TABLE tenants ADD CONSTRAINT tenants_plan_check
  CHECK (plan IN ('local', 'free', 'team', 'enterprise'));

-- ───────────────────────────────────────────
-- 2. handle_new_user: 'local' → 'free'
-- ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  new_tenant_id uuid;
  user_slug text;
BEGIN
  user_slug := 'personal-' || substr(NEW.id::text, 1, 8);
  INSERT INTO public.tenants (name, slug, plan)
    VALUES ('개인', user_slug, 'free')
    RETURNING id INTO new_tenant_id;
  INSERT INTO public.tenant_members (tenant_id, user_id, role)
    VALUES (new_tenant_id, NEW.id, 'owner');
  INSERT INTO public.profiles (id, display_name, active_tenant_id)
    VALUES (NEW.id, split_part(NEW.email, '@', 1), new_tenant_id);
  RETURN NEW;
END;
$$;

-- 기존 사용자 마이그레이션 (공용 local 테넌트 제외)
UPDATE tenants SET plan = 'free'
WHERE plan = 'local' AND id != '00000000-0000-0000-0000-000000000001';

-- ───────────────────────────────────────────
-- 3. tenant_invites
-- ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenant_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'member')),
  invited_by uuid NOT NULL REFERENCES auth.users(id),
  token text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invites_email ON tenant_invites(email) WHERE accepted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_invites_tenant ON tenant_invites(tenant_id);
ALTER TABLE tenant_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "invites_select_admin" ON tenant_invites;
DROP POLICY IF EXISTS "invites_insert_admin" ON tenant_invites;
DROP POLICY IF EXISTS "invites_delete_admin" ON tenant_invites;
DROP POLICY IF EXISTS "invites_select_by_email" ON tenant_invites;
DROP POLICY IF EXISTS "invites_update_self" ON tenant_invites;

CREATE POLICY "invites_select_admin" ON tenant_invites FOR SELECT
  USING (tenant_id IN (
    SELECT tenant_id FROM tenant_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ));
CREATE POLICY "invites_insert_admin" ON tenant_invites FOR INSERT
  WITH CHECK (tenant_id IN (
    SELECT tenant_id FROM tenant_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ));
CREATE POLICY "invites_delete_admin" ON tenant_invites FOR DELETE
  USING (tenant_id IN (
    SELECT tenant_id FROM tenant_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ));
CREATE POLICY "invites_select_by_email" ON tenant_invites FOR SELECT
  USING (email = (SELECT email FROM auth.users WHERE id = auth.uid()));
CREATE POLICY "invites_update_self" ON tenant_invites FOR UPDATE
  USING (email = (SELECT email FROM auth.users WHERE id = auth.uid()))
  WITH CHECK (email = (SELECT email FROM auth.users WHERE id = auth.uid()));

-- ───────────────────────────────────────────
-- 4. audit_logs
-- ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_logs (
  id bigserial PRIMARY KEY,
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_type text,
  target_id text,
  metadata jsonb DEFAULT '{}'::jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_tenant_created ON audit_logs(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor_id);
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_select_admin" ON audit_logs;
DROP POLICY IF EXISTS "audit_insert_self" ON audit_logs;

CREATE POLICY "audit_select_admin" ON audit_logs FOR SELECT
  USING (tenant_id IN (
    SELECT tenant_id FROM tenant_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ));
-- 클라이언트에서 자기 행동 기록만 허용 (actor_id = 본인)
CREATE POLICY "audit_insert_self" ON audit_logs FOR INSERT
  WITH CHECK (actor_id = auth.uid());

-- ───────────────────────────────────────────
-- 5. tenant_policies
-- ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenant_policies (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  require_pqc boolean DEFAULT false,
  require_timestamp boolean DEFAULT false,
  allow_password_encrypt boolean DEFAULT true,
  max_file_size_mb int DEFAULT 100,
  allowed_tsa_list text[] DEFAULT NULL,
  updated_by uuid REFERENCES auth.users(id),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE tenant_policies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "policy_select_member" ON tenant_policies;
DROP POLICY IF EXISTS "policy_insert_admin" ON tenant_policies;
DROP POLICY IF EXISTS "policy_update_admin" ON tenant_policies;
DROP POLICY IF EXISTS "policy_delete_admin" ON tenant_policies;

CREATE POLICY "policy_select_member" ON tenant_policies FOR SELECT
  USING (tenant_id IN (
    SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()
  ));
CREATE POLICY "policy_insert_admin" ON tenant_policies FOR INSERT
  WITH CHECK (tenant_id IN (
    SELECT tenant_id FROM tenant_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ));
CREATE POLICY "policy_update_admin" ON tenant_policies FOR UPDATE
  USING (tenant_id IN (
    SELECT tenant_id FROM tenant_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ))
  WITH CHECK (tenant_id IN (
    SELECT tenant_id FROM tenant_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ));
CREATE POLICY "policy_delete_admin" ON tenant_policies FOR DELETE
  USING (tenant_id IN (
    SELECT tenant_id FROM tenant_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ));

-- ───────────────────────────────────────────
-- 6. system_admins
-- ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS system_admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'superadmin')),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE system_admins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sys_select_self" ON system_admins;
CREATE POLICY "sys_select_self" ON system_admins FOR SELECT
  USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.is_system_admin()
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM system_admins WHERE user_id = auth.uid());
$$;

-- system_admin 전용 전체 테넌트 조회 정책
DROP POLICY IF EXISTS "tenants_select_sysadmin" ON tenants;
CREATE POLICY "tenants_select_sysadmin" ON tenants FOR SELECT
  USING (public.is_system_admin());

DROP POLICY IF EXISTS "members_select_sysadmin" ON tenant_members;
CREATE POLICY "members_select_sysadmin" ON tenant_members FOR SELECT
  USING (public.is_system_admin());

DROP POLICY IF EXISTS "audit_select_sysadmin" ON audit_logs;
CREATE POLICY "audit_select_sysadmin" ON audit_logs FOR SELECT
  USING (public.is_system_admin());

-- ───────────────────────────────────────────
-- 7. 초기 superadmin 등록 (jkkim@innotium.com)
-- ───────────────────────────────────────────
INSERT INTO system_admins (user_id, role)
SELECT id, 'superadmin' FROM auth.users WHERE email = 'jkkim@innotium.com'
ON CONFLICT (user_id) DO NOTHING;

COMMIT;
