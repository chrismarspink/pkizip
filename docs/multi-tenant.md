# pkizip 멀티테넌트 설계

> B안 (전면 재설계) 기준
> 작성일: 2026-04-22

---

## 1. 사용자 3-tier 모델

```
Tier 0. Device-only       로그인 X        IndexedDB만 사용 (로컬 전용)
Tier 1. Personal          로그인 O        개인 테넌트 (plan=free)
Tier 2. Organization      팀/기업         다인 테넌트 (plan=team|enterprise)
```

### 사용자 상태 판별 로직
```
user === null                                       → Tier 0
user != null && activeTenant.plan === 'free'        → Tier 1
user != null && activeTenant.plan in (team|enterprise) → Tier 2
```

### Tier별 허용 기능
| 기능 | Tier 0 | Tier 1 | Tier 2 |
|------|:-:|:-:|:-:|
| 로컬 파일 서명/암호화 | O | O | O |
| 니모닉 서버 백업 (5개) | X | O | O |
| 인증서 공유 (5개) | X | O | O |
| 조직 인증서 디렉토리 | X | X | O |
| 멤버 관리 | X | X | O (owner/admin) |
| 감사 로그 | X | X | O (enterprise) |
| SSO (SAML/OIDC) | X | X | O (enterprise) |
| 사용량 제한 | 로컬제한 | 5/5 | 플랜별 |

---

## 2. 관리자 4-tier 모델

```
L1. Device Admin          본인(로컬) — /settings
L2. Personal Admin        본인(로그인) — /settings + /me
L3. Organization Admin    테넌트 owner/admin — /team/:slug
L4. System Admin          pkizip 운영자 — /admin
```

### 역할별 권한
| 권한 | member | admin | owner | system_admin |
|------|:-:|:-:|:-:|:-:|
| 자기 키/파일 관리 | O | O | O | O |
| 조직 인증서 조회 | O | O | O | O |
| 멤버 초대/제거 | X | O | O | O |
| 역할 변경 | X | O (owner제외) | O | O |
| 정책 편집 | X | O | O | O |
| 감사 로그 열람 | X | O | O | O |
| 결제/플랜 변경 | X | X | O | O |
| 테넌트 삭제 | X | X | O | O |
| 전역 테넌트 목록 | X | X | X | O |
| 사용자 정지 | X | X | X | O |
| 시스템 인증서 마스터 | X | X | X | O |

---

## 3. 스키마 (SQL)

### 3.1 기존 테이블 수정
```sql
-- plan enum 확장
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_plan_check;
ALTER TABLE tenants ADD CONSTRAINT tenants_plan_check
  CHECK (plan IN ('local', 'free', 'team', 'enterprise'));

-- handle_new_user 트리거 수정 (plan='local' → 'free')
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
```

### 3.2 tenant_invites (조직 초대)
```sql
CREATE TABLE tenant_invites (
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

CREATE INDEX idx_invites_email ON tenant_invites(email) WHERE accepted_at IS NULL;
CREATE INDEX idx_invites_tenant ON tenant_invites(tenant_id);
ALTER TABLE tenant_invites ENABLE ROW LEVEL SECURITY;

-- 테넌트 owner/admin만 조회/생성/취소 가능
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
-- 초대받은 사용자는 token으로 직접 조회 (토큰이 해시되어 있으므로)
CREATE POLICY "invites_select_by_email" ON tenant_invites FOR SELECT
  USING (email = (SELECT email FROM auth.users WHERE id = auth.uid()));
```

### 3.3 audit_logs (감사 로그)
```sql
CREATE TABLE audit_logs (
  id bigserial PRIMARY KEY,
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,         -- 'member.invite', 'cert.share', 'tenant.plan_change' 등
  target_type text,             -- 'user' | 'cert' | 'tenant' | 'file'
  target_id text,
  metadata jsonb DEFAULT '{}'::jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_tenant_created ON audit_logs(tenant_id, created_at DESC);
CREATE INDEX idx_audit_actor ON audit_logs(actor_id);
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_select_admin" ON audit_logs FOR SELECT
  USING (tenant_id IN (
    SELECT tenant_id FROM tenant_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ));
-- INSERT는 서비스(Edge Function) 또는 트리거만 가능
```

### 3.4 tenant_policies (조직 정책)
```sql
CREATE TABLE tenant_policies (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  require_pqc boolean DEFAULT false,          -- 모든 .pki에 PQC 강제
  require_timestamp boolean DEFAULT false,    -- TSA 타임스탬프 강제
  allow_password_encrypt boolean DEFAULT true,-- 비밀번호 암호화 허용
  max_file_size_mb int DEFAULT 100,
  allowed_tsa_list text[] DEFAULT NULL,       -- NULL=제한없음
  updated_by uuid REFERENCES auth.users(id),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE tenant_policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "policy_select_member" ON tenant_policies FOR SELECT
  USING (tenant_id IN (
    SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()
  ));
CREATE POLICY "policy_upsert_admin" ON tenant_policies FOR ALL
  USING (tenant_id IN (
    SELECT tenant_id FROM tenant_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ))
  WITH CHECK (tenant_id IN (
    SELECT tenant_id FROM tenant_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ));
```

### 3.5 system_admins (시스템 관리자)
```sql
CREATE TABLE system_admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'superadmin')),
  created_at timestamptz DEFAULT now()
);

-- 조회는 system_admin만
ALTER TABLE system_admins ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sys_select_self" ON system_admins FOR SELECT
  USING (user_id = auth.uid());

-- 헬퍼 함수: 현재 사용자가 시스템 관리자인지
CREATE OR REPLACE FUNCTION public.is_system_admin()
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM system_admins WHERE user_id = auth.uid());
$$;
```

### 3.6 전역 조회용 뷰 (system_admin 전용)
```sql
-- tenants 전체 조회 (멤버 수 포함)
CREATE OR REPLACE VIEW admin_tenants_view AS
SELECT t.*, (SELECT count(*) FROM tenant_members WHERE tenant_id = t.id) AS member_count
FROM tenants t;

-- system_admin은 모든 tenants 조회
CREATE POLICY "tenants_select_sysadmin" ON tenants FOR SELECT
  USING (public.is_system_admin());
```

---

## 4. 라우팅

```
/                     홈 (Tier 0/1/2 공통)
/create               파일 생성
/files                임시 파일
/certs                인증서
/contacts             주소록
/settings             개인 설정

--- 신규 ---
/me                                  내 계정 (Tier 1+)
  /profile                           프로필
  /tenants                           소속 테넌트 목록
  /invites                           받은 초대

/team/:slug                          조직 (Tier 2)
  /                                  대시보드
  /members                           멤버 관리
  /invites                           초대 관리
  /certs                             조직 인증서 디렉토리
  /policies                          보안 정책
  /audit                             감사 로그
  /billing                           결제/플랜

/admin                               시스템 관리 (L4)
  /                                  대시보드
  /tenants                           모든 테넌트
  /users                             사용자 검색/정지
  /tsa-certs                         전역 TSA 마스터
  /audit                             전역 감사 로그
```

### 라우트 가드
```tsx
<Route path="/team/:slug" element={<TenantGuard roles={['owner','admin','member']}/>}>
<Route path="/team/:slug/members" element={<TenantGuard roles={['owner','admin']}/>}>
<Route path="/team/:slug/billing" element={<TenantGuard roles={['owner']}/>}>
<Route path="/admin" element={<SystemAdminGuard/>}>
```

---

## 5. UI 구성

### 5.1 헤더 (AppShell 확장)
```
[pkizip 로고]  [테넌트 스위처 ▼]  ...              [시스템관리 (L4만)] [⚙] [사용자 ▼]
```

### 5.2 테넌트 스위처 드롭다운
```
현재: 회사 키 (admin)
───────────────
  ✓ 개인 (free)
    회사 키 (team, admin)
    파트너 (enterprise, member)
───────────────
  + 초대 수락 (1)
  + 새 조직 만들기
```

### 5.3 /team/:slug 레이아웃
```
┌─ 조직 헤더 ──────────────────┐
│ 회사 키 (team)  [업그레이드]   │
├─ 탭 ──────────────────────────┤
│ 대시보드|멤버|초대|인증서|정책|감사|결제 │
├─ 콘텐츠 ─────────────────────┤
```

### 5.4 /admin 레이아웃 (별도 쉘)
L4 진입 시 경고 배너: "시스템 관리 모드 — 모든 동작이 기록됩니다"

---

## 6. 주요 플로우

### 6.1 조직 생성
1. 개인 사용자가 `/me/tenants` 에서 "+ 새 조직" 클릭
2. 이름/슬러그 입력 → `tenants` 생성 (plan='team')
3. 생성자 = owner로 `tenant_members` 삽입
4. `profiles.active_tenant_id` = 새 테넌트

### 6.2 멤버 초대
1. owner/admin이 `/team/:slug/members` 에서 이메일 + 역할 입력
2. `tenant_invites` 삽입 (token = 해시, 7일 만료)
3. (Edge Function) 이메일 발송 — 초대 링크 `/invites/:token`
4. 로그인/가입 후 자동 수락 → `tenant_members` 삽입, `accepted_at` 업데이트
5. `audit_logs`: action='member.invite'

### 6.3 시스템 관리자 승격 (초기 부트스트랩)
최초 1회 SQL로 수동 삽입:
```sql
INSERT INTO system_admins (user_id, role)
SELECT id, 'superadmin' FROM auth.users WHERE email = 'jkkim@innotium.com';
```

### 6.4 플랜 변경
- free → team: 결제 확인 후 plan 업데이트, 정책 기본값 생성
- team → enterprise: 감사 로그 + SSO 설정 활성
- 다운그레이드: 초과 멤버 경고 후 진행

---

## 7. 구현 순서

1. **docs/multi-tenant.md** (본 문서)
2. **SQL migration** — 사용자가 Supabase에서 실행
3. **lib/supabase/tenants.ts** — 테넌트 CRUD
4. **lib/supabase/invites.ts** — 초대
5. **lib/supabase/audit.ts** — 감사 로그 기록
6. **lib/supabase/system-admin.ts** — L4 API
7. **components/tenant/TenantSwitcher.tsx** — 헤더 드롭다운
8. **pages/MePage/** — 내 계정 탭
9. **pages/TeamPage/** — 조직 관리 (tabs)
10. **pages/AdminPage/** — 시스템 관리
11. **가드 컴포넌트** — TenantGuard, SystemAdminGuard
12. **라우트 + 네비 연결**
13. **빌드 + GitHub Pages 배포**

---

## 8. 마이그레이션 전략

기존 사용자:
- `profiles.active_tenant_id`가 개인 테넌트를 가리키면 → `plan='local'` → `'free'`로 업데이트
- `'00000000-0000-0000-0000-000000000001'` (공용 Local 테넌트)는 유지하되 로그인 사용자는 더 이상 연결되지 않음
- 미로그인 = Tier 0으로만 동작

```sql
UPDATE tenants SET plan = 'free'
WHERE plan = 'local' AND id != '00000000-0000-0000-0000-000000000001';
```

---

## 9. 향후 과제

- Edge Function: 초대 이메일 발송, TSA 프록시
- SSO: SAML (enterprise)
- Webhook: 감사 로그 외부 SIEM 연동
- 빌링: Stripe 연동 (team/enterprise)
- 2FA (system_admin 필수)
