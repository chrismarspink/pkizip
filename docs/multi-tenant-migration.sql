-- ============================================
-- pkizip Multi-tenant Migration (B plan)
-- 2026-04-22
-- ============================================
-- Supabase SQL Editor에서 한 번에 실행 가능 (idempotent)

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
-- 3. 신규 테이블
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

CREATE TABLE IF NOT EXISTS system_admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'superadmin')),
  created_at timestamptz DEFAULT now()
);
ALTER TABLE system_admins ENABLE ROW LEVEL SECURITY;

-- ───────────────────────────────────────────
-- 4. 헬퍼 함수 (SECURITY DEFINER — RLS 재귀 방지)
-- ───────────────────────────────────────────
DROP FUNCTION IF EXISTS public.is_system_admin()        CASCADE;
DROP FUNCTION IF EXISTS public.is_tenant_member(uuid)   CASCADE;
DROP FUNCTION IF EXISTS public.is_tenant_admin(uuid)    CASCADE;
DROP FUNCTION IF EXISTS public.is_tenant_owner(uuid)    CASCADE;

CREATE FUNCTION public.is_system_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp SET row_security = off AS $$
  SELECT EXISTS (SELECT 1 FROM public.system_admins WHERE user_id = auth.uid());
$$;

CREATE FUNCTION public.is_tenant_member(tid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp SET row_security = off AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members WHERE tenant_id = tid AND user_id = auth.uid()
  );
$$;

CREATE FUNCTION public.is_tenant_admin(tid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp SET row_security = off AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members
    WHERE tenant_id = tid AND user_id = auth.uid() AND role IN ('owner','admin')
  );
$$;

CREATE FUNCTION public.is_tenant_owner(tid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp SET row_security = off AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members
    WHERE tenant_id = tid AND user_id = auth.uid() AND role = 'owner'
  );
$$;

-- tenant + owner 원자적 생성 (RETURNING RLS 우회)
CREATE OR REPLACE FUNCTION public.create_tenant_with_owner(
  p_name text, p_slug text, p_plan text DEFAULT 'team'
) RETURNS SETOF tenants
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp SET row_security = off AS $$
DECLARE
  new_tenant tenants;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_plan NOT IN ('free','team','enterprise') THEN
    RAISE EXCEPTION 'invalid plan: %', p_plan;
  END IF;

  INSERT INTO public.tenants (name, slug, plan)
  VALUES (p_name, p_slug, p_plan)
  RETURNING * INTO new_tenant;

  INSERT INTO public.tenant_members (tenant_id, user_id, role)
  VALUES (new_tenant.id, auth.uid(), 'owner');

  RETURN NEXT new_tenant;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_tenant_with_owner(text, text, text) TO authenticated;

-- ───────────────────────────────────────────
-- 5. 기존 정책 전부 제거 (구 이름 + 새 이름)
-- ───────────────────────────────────────────
DROP POLICY IF EXISTS "tenants_select_member"       ON tenants;
DROP POLICY IF EXISTS "tenants_select_sysadmin"     ON tenants;
DROP POLICY IF EXISTS "tenants_insert_authenticated" ON tenants;
DROP POLICY IF EXISTS "tenants_update_admin"        ON tenants;
DROP POLICY IF EXISTS "tenants_delete_owner"        ON tenants;
DROP POLICY IF EXISTS "tenants_select"              ON tenants;
DROP POLICY IF EXISTS "tenants_insert"              ON tenants;
DROP POLICY IF EXISTS "tenants_update"              ON tenants;
DROP POLICY IF EXISTS "tenants_delete"              ON tenants;

DROP POLICY IF EXISTS "members_select_own"          ON tenant_members;
DROP POLICY IF EXISTS "members_select_same_tenant"  ON tenant_members;
DROP POLICY IF EXISTS "members_select_sysadmin"     ON tenant_members;
DROP POLICY IF EXISTS "members_insert_self"         ON tenant_members;
DROP POLICY IF EXISTS "members_insert_admin"        ON tenant_members;
DROP POLICY IF EXISTS "members_update_admin"        ON tenant_members;
DROP POLICY IF EXISTS "members_delete_admin"        ON tenant_members;
DROP POLICY IF EXISTS "members_select"              ON tenant_members;
DROP POLICY IF EXISTS "members_insert"              ON tenant_members;
DROP POLICY IF EXISTS "members_update"              ON tenant_members;
DROP POLICY IF EXISTS "members_delete"              ON tenant_members;

DROP POLICY IF EXISTS "invites_select_admin"        ON tenant_invites;
DROP POLICY IF EXISTS "invites_insert_admin"        ON tenant_invites;
DROP POLICY IF EXISTS "invites_delete_admin"        ON tenant_invites;
DROP POLICY IF EXISTS "invites_select_by_email"     ON tenant_invites;
DROP POLICY IF EXISTS "invites_update_self"         ON tenant_invites;
DROP POLICY IF EXISTS "invites_select"              ON tenant_invites;
DROP POLICY IF EXISTS "invites_insert"              ON tenant_invites;
DROP POLICY IF EXISTS "invites_update"              ON tenant_invites;
DROP POLICY IF EXISTS "invites_delete"              ON tenant_invites;

DROP POLICY IF EXISTS "audit_select_admin"          ON audit_logs;
DROP POLICY IF EXISTS "audit_insert_self"           ON audit_logs;
DROP POLICY IF EXISTS "audit_select_sysadmin"       ON audit_logs;
DROP POLICY IF EXISTS "audit_select"                ON audit_logs;
DROP POLICY IF EXISTS "audit_insert"                ON audit_logs;

DROP POLICY IF EXISTS "policy_select_member"        ON tenant_policies;
DROP POLICY IF EXISTS "policy_insert_admin"         ON tenant_policies;
DROP POLICY IF EXISTS "policy_update_admin"         ON tenant_policies;
DROP POLICY IF EXISTS "policy_delete_admin"         ON tenant_policies;
DROP POLICY IF EXISTS "policy_select"               ON tenant_policies;
DROP POLICY IF EXISTS "policy_insert"               ON tenant_policies;
DROP POLICY IF EXISTS "policy_update"               ON tenant_policies;
DROP POLICY IF EXISTS "policy_delete"               ON tenant_policies;

DROP POLICY IF EXISTS "sys_select_self"             ON system_admins;

-- ───────────────────────────────────────────
-- 6. 재작성된 정책 (헬퍼 함수 사용 → 재귀 없음)
-- ───────────────────────────────────────────

-- tenants
CREATE POLICY "tenants_select" ON tenants FOR SELECT
  USING (public.is_tenant_member(id) OR public.is_system_admin());
CREATE POLICY "tenants_insert" ON tenants FOR INSERT
  TO authenticated WITH CHECK (true);
CREATE POLICY "tenants_update" ON tenants FOR UPDATE
  USING (public.is_tenant_admin(id) OR public.is_system_admin())
  WITH CHECK (public.is_tenant_admin(id) OR public.is_system_admin());
CREATE POLICY "tenants_delete" ON tenants FOR DELETE
  USING (public.is_tenant_owner(id) OR public.is_system_admin());

-- tenant_members
CREATE POLICY "members_select" ON tenant_members FOR SELECT
  USING (user_id = auth.uid() OR public.is_tenant_member(tenant_id) OR public.is_system_admin());
CREATE POLICY "members_insert" ON tenant_members FOR INSERT
  WITH CHECK (user_id = auth.uid() OR public.is_tenant_admin(tenant_id));
CREATE POLICY "members_update" ON tenant_members FOR UPDATE
  USING (public.is_tenant_admin(tenant_id))
  WITH CHECK (public.is_tenant_admin(tenant_id));
CREATE POLICY "members_delete" ON tenant_members FOR DELETE
  USING (public.is_tenant_admin(tenant_id) OR user_id = auth.uid());

-- tenant_invites
CREATE POLICY "invites_select" ON tenant_invites FOR SELECT
  USING (public.is_tenant_admin(tenant_id)
    OR email = (SELECT email FROM auth.users WHERE id = auth.uid()));
CREATE POLICY "invites_insert" ON tenant_invites FOR INSERT
  WITH CHECK (public.is_tenant_admin(tenant_id));
CREATE POLICY "invites_update" ON tenant_invites FOR UPDATE
  USING (email = (SELECT email FROM auth.users WHERE id = auth.uid()))
  WITH CHECK (email = (SELECT email FROM auth.users WHERE id = auth.uid()));
CREATE POLICY "invites_delete" ON tenant_invites FOR DELETE
  USING (public.is_tenant_admin(tenant_id));

-- audit_logs
CREATE POLICY "audit_select" ON audit_logs FOR SELECT
  USING ((tenant_id IS NOT NULL AND public.is_tenant_admin(tenant_id))
    OR public.is_system_admin());
CREATE POLICY "audit_insert" ON audit_logs FOR INSERT
  WITH CHECK (actor_id = auth.uid());

-- tenant_policies
CREATE POLICY "policy_select" ON tenant_policies FOR SELECT
  USING (public.is_tenant_member(tenant_id));
CREATE POLICY "policy_insert" ON tenant_policies FOR INSERT
  WITH CHECK (public.is_tenant_admin(tenant_id));
CREATE POLICY "policy_update" ON tenant_policies FOR UPDATE
  USING (public.is_tenant_admin(tenant_id))
  WITH CHECK (public.is_tenant_admin(tenant_id));
CREATE POLICY "policy_delete" ON tenant_policies FOR DELETE
  USING (public.is_tenant_admin(tenant_id));

-- system_admins
CREATE POLICY "sys_select_self" ON system_admins FOR SELECT
  USING (user_id = auth.uid());

-- ───────────────────────────────────────────
-- 7. 초기 superadmin 등록 (jkkim@innotium.com)
-- ───────────────────────────────────────────
INSERT INTO system_admins (user_id, role)
SELECT id, 'superadmin' FROM auth.users WHERE email = 'jkkim@innotium.com'
ON CONFLICT (user_id) DO NOTHING;

COMMIT;
