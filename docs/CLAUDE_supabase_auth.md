# Claude Code 지시문: Supabase 인증 + 멀티테넌트 + 니모닉 백업 + 인증서 디렉토리 v2

> **Supabase 프로젝트 정보**
> - URL: `https://ikyhpuerwljxypyzkpiw.supabase.co`
> - Anon Key: `sb_publishable_X40NyHIx3u1qsFwLftTUuw_Ep4GE6l1`
> - Project ID: `ikyhpuerwljxypyzkpiw`

---

## 0. 절대 규칙

```
[MUST]  니모닉 원문(12단어)은 절대 서버에 평문 저장 금지
[MUST]  암호화는 클라이언트 사이드에서만 수행
[MUST]  로그인 없이도 pkizip 핵심 기능 100% 사용 가능 (로그인은 선택)
[MUST]  TypeScript strict 유지
[SKIP]  Google 소셜 로그인 구현 금지 (이메일+패스워드만)
[SKIP]  기존 BIP32/BIP39/PQC 암호화 로직 수정 금지
[SKIP]  기존 IndexedDB 키 저장 구조 수정 금지
```

---

## 1. 패키지 설치

```bash
npm install @supabase/supabase-js
```

---

## 2. Supabase 클라이언트

### 신규: `src/lib/supabase/client.ts`

```typescript
import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  'https://ikyhpuerwljxypyzkpiw.supabase.co',
  'sb_publishable_X40NyHIx3u1qsFwLftTUuw_Ep4GE6l1'
)
```

---

## 3. DB 스키마 (Supabase SQL Editor에서 실행)

```sql
-- ── 테넌트 ──────────────────────────────────────────────────────
CREATE TABLE tenants (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  slug       TEXT UNIQUE NOT NULL,
  plan       TEXT NOT NULL DEFAULT 'local',  -- local | team | enterprise
  created_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO tenants (id, name, slug, plan)
VALUES ('00000000-0000-0000-0000-000000000001', 'Local', 'local', 'local');

-- ── 테넌트 멤버 ─────────────────────────────────────────────────
CREATE TABLE tenant_members (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role      TEXT NOT NULL DEFAULT 'member',  -- owner | admin | member
  joined_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (tenant_id, user_id)
);

-- ── 사용자 프로필 ────────────────────────────────────────────────
CREATE TABLE profiles (
  id               UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name     TEXT,
  active_tenant_id UUID REFERENCES tenants(id),
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

-- 신규 가입 시 프로필 + 개인 테넌트 자동 생성
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE new_tenant_id UUID;
BEGIN
  INSERT INTO tenants (name, slug, plan)
  VALUES (NEW.email, 'personal-' || NEW.id, 'local')
  RETURNING id INTO new_tenant_id;

  INSERT INTO profiles (id, display_name, active_tenant_id)
  VALUES (NEW.id, split_part(NEW.email, '@', 1), new_tenant_id);

  INSERT INTO tenant_members (tenant_id, user_id, role)
  VALUES (new_tenant_id, NEW.id, 'owner');

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ── 니모닉 암호화 백업 ───────────────────────────────────────────
CREATE TABLE mnemonic_backups (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  identity_id    TEXT NOT NULL,
  encrypted_blob TEXT NOT NULL,     -- Base64(AES-256-GCM 암호문)
  kdf_salt       TEXT NOT NULL,     -- Base64 PBKDF2 salt
  kdf_iterations INTEGER NOT NULL DEFAULT 600000,
  iv             TEXT NOT NULL,     -- Base64 GCM nonce
  hint           TEXT,
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, identity_id)
);

-- ── 인증서 번들 디렉토리 (공개) ──────────────────────────────────
CREATE TABLE cert_bundles (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  username     TEXT UNIQUE NOT NULL,  -- URL 슬러그: pkizip.app/k/{username}
  display_name TEXT NOT NULL,
  email        TEXT,
  -- 인증서 PEM (공개키만, 개인키 절대 저장 금지)
  cert_classic TEXT,   -- ECDSA P-256 X.509 PEM
  cert_kem     TEXT,   -- ML-KEM-1024 X.509 PEM
  cert_dsa     TEXT,   -- ML-DSA-87 X.509 PEM
  fingerprint  TEXT,
  is_public    BOOLEAN NOT NULL DEFAULT true,
  uploaded_at  TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id)     -- 사용자당 번들 1개
);

CREATE INDEX idx_cert_bundles_username ON cert_bundles (username);
CREATE INDEX idx_cert_bundles_name     ON cert_bundles (lower(display_name));
CREATE INDEX idx_cert_bundles_email    ON cert_bundles (lower(email));

-- ── Row Level Security ───────────────────────────────────────────
ALTER TABLE profiles         ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants          ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_members   ENABLE ROW LEVEL SECURITY;
ALTER TABLE mnemonic_backups ENABLE ROW LEVEL SECURITY;
ALTER TABLE cert_bundles     ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_own"    ON profiles         FOR ALL    USING (auth.uid() = id);
CREATE POLICY "tenants_read"    ON tenants          FOR SELECT USING (
  id = '00000000-0000-0000-0000-000000000001'
  OR id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid())
);
CREATE POLICY "tm_read"         ON tenant_members   FOR SELECT USING (
  tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid())
);
CREATE POLICY "tm_insert"       ON tenant_members   FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM tenant_members
    WHERE tenant_id = tenant_members.tenant_id
      AND user_id = auth.uid() AND role IN ('owner','admin'))
);
CREATE POLICY "backup_own"      ON mnemonic_backups FOR ALL    USING (auth.uid() = user_id);
-- 로그인 사용자만 조회 가능 (비로그인 조회 불가)
CREATE POLICY "cert_auth_read"  ON cert_bundles    FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "cert_own_write"  ON cert_bundles    FOR ALL    USING (auth.uid() = user_id);
```

---

## 4. 인증 스토어

### 신규: `src/lib/supabase/auth-store.ts`

```typescript
import { create }  from 'zustand'
import { supabase } from './client'
import type { User, Session } from '@supabase/supabase-js'

export interface Profile {
  id: string; display_name: string | null; active_tenant_id: string | null
}
export interface Tenant {
  id: string; name: string; slug: string
  plan: 'local'|'team'|'enterprise'; role?: 'owner'|'admin'|'member'
}

interface AuthState {
  user: User|null; session: Session|null
  profile: Profile|null; activeTenant: Tenant|null; loading: boolean
  signIn:      (email: string, password: string) => Promise<void>
  signUp:      (email: string, password: string) => Promise<void>
  signOut:     () => Promise<void>
  loadProfile: () => Promise<void>
  switchTenant:(tenantId: string) => Promise<void>
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null, session: null, profile: null, activeTenant: null, loading: true,

  signIn: async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  },
  signUp: async (email, password) => {
    const { error } = await supabase.auth.signUp({ email, password })
    if (error) throw error
  },
  signOut: async () => {
    await supabase.auth.signOut()
    set({ user: null, session: null, profile: null, activeTenant: null })
  },
  loadProfile: async () => {
    const { data: p } = await supabase.from('profiles').select('*').single()
    if (!p) return
    const { data: members } = await supabase
      .from('tenant_members').select('tenant_id, role, tenants(*)')
      .eq('user_id', p.id)
    const active = members?.find(m => m.tenant_id === p.active_tenant_id)
    set({ profile: p, activeTenant: active ? { ...active.tenants, role: active.role } : null })
  },
  switchTenant: async (tenantId) => {
    await supabase.from('profiles')
      .update({ active_tenant_id: tenantId }).eq('id', get().user!.id)
    await get().loadProfile()
  },
}))

supabase.auth.onAuthStateChange(async (_e, session) => {
  useAuthStore.setState({ session, user: session?.user ?? null, loading: false })
  if (session?.user) await useAuthStore.getState().loadProfile()
})
```

---

## 5. 니모닉 백업/복구

### 신규: `src/lib/supabase/mnemonic-backup.ts`

```typescript
import { supabase } from './client'
import { pbkdf2 }  from '@noble/hashes/pbkdf2'
import { sha256 }  from '@noble/hashes/sha2'

const toB64 = (b: Uint8Array) => btoa(String.fromCharCode(...b))
const frB64 = (s: string)     => Uint8Array.from(atob(s), c => c.charCodeAt(0))

/** 클라이언트 사이드 암호화 → Supabase 저장 */
export async function backupMnemonic(
  mnemonic: string, backupPassword: string,
  identityId: string, hint?: string
): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(32))
  const iv   = crypto.getRandomValues(new Uint8Array(12))
  const key  = await crypto.subtle.importKey('raw',
    pbkdf2(sha256, backupPassword, salt, { c: 600_000, dkLen: 32 }),
    { name: 'AES-GCM' }, false, ['encrypt'])
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key,
    new TextEncoder().encode(mnemonic))
  const { error } = await supabase.from('mnemonic_backups').upsert({
    identity_id: identityId, encrypted_blob: toB64(new Uint8Array(ct)),
    kdf_salt: toB64(salt), kdf_iterations: 600_000,
    iv: toB64(iv), hint: hint ?? null, updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,identity_id' })
  if (error) throw new Error(`백업 저장 실패: ${error.message}`)
}

/** Supabase에서 조회 → 복호화 → 니모닉 반환 */
export async function restoreMnemonic(
  backupPassword: string, identityId: string
): Promise<string> {
  const { data, error } = await supabase
    .from('mnemonic_backups').select('*').eq('identity_id', identityId).single()
  if (error || !data) throw new Error('백업을 찾을 수 없습니다')
  const key = await crypto.subtle.importKey('raw',
    pbkdf2(sha256, backupPassword, frB64(data.kdf_salt),
      { c: data.kdf_iterations, dkLen: 32 }),
    { name: 'AES-GCM' }, false, ['decrypt'])
  try {
    return new TextDecoder().decode(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: frB64(data.iv) }, key, frB64(data.encrypted_blob)))
  } catch {
    throw new Error('백업 패스워드가 올바르지 않습니다')
  }
}

export async function listBackups() {
  const { data } = await supabase.from('mnemonic_backups')
    .select('identity_id, hint, updated_at').order('updated_at', { ascending: false })
  return data ?? []
}
```

---

## 6. 인증서 번들 디렉토리

### 신규: `src/lib/supabase/cert-directory.ts`

```typescript
import { supabase } from './client'

export interface CertBundle {
  id: string; username: string; display_name: string; email?: string
  cert_classic?: string; cert_kem?: string; cert_dsa?: string
  fingerprint?: string; uploaded_at: string; updated_at: string
}

/** 인증서 번들 업로드 또는 갱신 */
export async function uploadCertBundle(bundle: {
  username: string; display_name: string; email?: string
  cert_classic?: string; cert_kem?: string; cert_dsa?: string
  fingerprint?: string
}): Promise<void> {
  if (!/^[a-z0-9-]{3,32}$/.test(bundle.username))
    throw new Error('username은 소문자·숫자·하이픈 3~32자만 가능합니다')
  const { error } = await supabase.from('cert_bundles').upsert(
    { ...bundle, is_public: true, updated_at: new Date().toISOString() },
    { onConflict: 'user_id' }
  )
  if (error) {
    if (error.code === '23505') throw new Error('이미 사용 중인 username입니다')
    throw new Error(`업로드 실패: ${error.message}`)
  }
}

/** 내 인증서 번들 조회 */
export async function getMyCertBundle(): Promise<CertBundle | null> {
  const { data } = await supabase.from('cert_bundles').select('*').single()
  return data
}

/** 인증서 번들 삭제 */
export async function deleteCertBundle(): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser()
  const { error } = await supabase.from('cert_bundles').delete().eq('user_id', user!.id)
  if (error) throw new Error(`삭제 실패: ${error.message}`)
}

/** 이름/이메일/username으로 검색 (로그인 필수 — 비로그인 조회 불가) */
export async function searchCertBundles(query: string): Promise<CertBundle[]> {
  const q = query.trim().toLowerCase()
  if (q.length < 2) return []
  const { data } = await supabase.from('cert_bundles')
    .select('id,username,display_name,email,fingerprint,cert_kem,cert_dsa,cert_classic,uploaded_at,updated_at')
    .eq('is_public', true)
    .or(`username.ilike.%${q}%,display_name.ilike.%${q}%,email.ilike.%${q}%`)
    .limit(20)
  return data ?? []
}

/** username 단건 조회 (로그인 필수) */
export async function getCertBundleByUsername(username: string): Promise<CertBundle | null> {
  const { data } = await supabase.from('cert_bundles')
    .select('*').eq('username', username.toLowerCase()).single()
  return data
}
```

---

## 7. MnemonicDialog.tsx 수정 — 백업 옵션 추가

니모닉 생성 마지막 단계(완료 직전)에 아래 UI를 추가한다:

```
[체크박스] 서버에 암호화 백업 저장 (opt-in, 기본 unchecked)

  체크 시 아래 입력 표시:

  [입력] 백업 패스워드 (필수, 최소 8자)
         placeholder: "니모닉 패스워드와 다른 패스워드 권장"

  [입력] 패스워드 확인

  [입력] 힌트 (선택)
         placeholder: "나만 아는 힌트 (패스워드 자체 입력 금지)"

  [경고 박스 amber]
    "백업 패스워드를 잊으면 복구 불가.
     서버에는 암호화된 데이터만 저장됩니다."

비로그인 상태:
  체크박스 비활성화
  안내: "서버 백업은 로그인 후 사용 가능합니다"

완료 버튼 클릭 시:
  백업 옵션 선택 + 로그인 → backupMnemonic() 호출
  백업 실패 시 → toast 경고 (니모닉 생성 자체는 성공)
```

---

## 8. Contacts 탭 (인증서 검색/설치)

### 신규: `src/pages/ContactsPage.tsx`

```
탭 이름: Contacts
아이콘: Lucide BookUser
경로: /contacts

로그인 필수 — 비로그인 시 "로그인 후 이용 가능합니다" 안내

─── 상단 검색바 ────────────────────────────────────
입력: 이름, 이메일, username
최소 2자 입력 시 자동 검색 (debounce 300ms)
검색 결과 최대 20건

─── 검색 결과 카드 ──────────────────────────────────
각 카드:
  display_name (굵게)
  email (회색)
  @username  →  클릭 시 pkizip.app/k/{username} 복사
  fingerprint 앞 8자
  보유 인증서 배지: [ECDSA] [ML-KEM] [ML-DSA]
  [키링에 추가] 버튼

키링 추가 동작:
  key-manager.ts의 keyring 스토어에 저장:
  { fingerprint, name, email, certClassic, certKem, certDsa,
    source: 'contacts', addedAt: Date.now() }
  성공 toast: "{name}을 키링에 추가했습니다"
  중복 toast: "이미 키링에 있습니다"

─── 빈 상태 ─────────────────────────────────────────
검색 전: "이름, 이메일, username으로 검색하세요"
결과 없음: "검색 결과가 없습니다"
```

---

## 9. SettingsPage.tsx 수정 — 인증서 공유 섹션

기존 PQC 섹션 아래에 추가 (로그인 시만 표시):

```
─── 인증서 공유 ──────────────────────────────────────

[업로드 전]
  username 입력 (3~32자, 소문자·숫자·하이픈)
  실시간 중복 확인 (debounce 500ms)
  업로드할 인증서 선택 (체크박스):
    [ ] ECDSA P-256
    [x] ML-KEM-1024  ← 기본 체크
    [x] ML-DSA-87    ← 기본 체크
  [업로드] 버튼

[업로드 후]
  내 주소: pkizip.app/k/{username}
  [복사] 버튼
  QR코드 (128×128)

  인증서 상태:
    ECDSA: ✓/✗  ML-KEM: ✓/✗  ML-DSA: ✓/✗

  마지막 업데이트: {상대 시간}

  [재업로드]  [삭제]  ← 삭제 시 확인 다이얼로그

비로그인:
  "로그인하면 인증서를 공유하고 검색할 수 있습니다" + [로그인] 버튼
```

---

## 10. AppShell.tsx 수정

```
PC 사이드바 하단 / 모바일 상단 바 우측:

[비로그인]
  Lucide UserRound 아이콘 + "로그인" 텍스트
  클릭 → AuthDialog

[로그인]
  이니셜 원형 아바타 (#175DDC 배경, 흰 글자)
  display_name (최대 12자, 말줄임)
  active_tenant.name (서브텍스트)
  상태 점: 초록(로그인) / 회색(비로그인)
  클릭 → UserMenu 드롭다운:
    내 계정
    테넌트 전환
    니모닉 백업
    인증서 공유 설정
    로그아웃
```

---

## 11. AuthDialog.tsx — 이메일 전용

```
Tab 1 — 로그인
  이메일 + 패스워드
  [로그인] 버튼 (#175DDC)
  → Tab 2 링크

Tab 2 — 회원가입
  이메일 + 패스워드(최소 8자) + 확인
  [회원가입] 버튼
  완료: "인증 이메일을 발송했습니다"

에러:
  미인증: "이메일 인증을 완료해 주세요"
  잘못된 자격: "이메일 또는 패스워드가 올바르지 않습니다"
  중복: "이미 가입된 이메일입니다"

Google 버튼 없음
```

---

## 12. 라우팅 및 탭 추가

### `src/App.tsx`

```typescript
import { ContactsPage } from './pages/ContactsPage'
// Routes에 추가:
<Route path="/contacts" element={<ContactsPage />} />
```

### 탭바 순서 (4개 → 5개)

```
생성(/)  |  파일(/files)  |  인증서(/certs)  |  Contacts(/contacts)  |  설정(/settings)
```

---

## 13. 파일 구조

```
src/
├── lib/supabase/
│   ├── client.ts              [신규]
│   ├── auth-store.ts          [신규]
│   ├── mnemonic-backup.ts     [신규]
│   └── cert-directory.ts      [신규]
│
├── components/
│   ├── auth/
│   │   ├── AuthDialog.tsx     [신규] 이메일 전용
│   │   └── UserMenu.tsx       [신규]
│   └── layout/
│       ├── AppShell.tsx       [수정]
│       ├── SidebarNav.tsx     [수정] Directory 탭 추가
│       └── BottomTabBar.tsx   [수정] Directory 탭 추가
│
├── pages/
│   ├── ContactsPage.tsx       [신규] Contacts 탭 (로그인 필수)
│   └── SettingsPage.tsx       [수정] 인증서 공유 섹션
│
└── components/dialogs/
    └── MnemonicDialog.tsx     [수정] 백업 옵션 추가
```

---

## 14. Supabase Dashboard 수동 설정

```
1. Authentication > Email Templates
   - 확인 이메일 제목: "PKIZIP 이메일 인증"

2. Authentication > URL Configuration
   - Site URL: https://chrismarspink.github.io/pkizip/
   - Redirect URLs: https://chrismarspink.github.io/pkizip/

3. SQL Editor에서 섹션 3 스키마 SQL 실행

※ Google OAuth 설정 불필요 (이메일 전용)
```

---

## 15. 체크리스트

```
[ ] npm install @supabase/supabase-js
[ ] client.ts 생성
[ ] SQL 스키마 실행
    [ ] tenants / tenant_members / profiles / 트리거
    [ ] mnemonic_backups
    [ ] cert_bundles (username UNIQUE, user_id UNIQUE, 인덱스)
    [ ] RLS 정책 전체
[ ] auth-store.ts (signIn/signUp/signOut/loadProfile/switchTenant)
[ ] mnemonic-backup.ts (backup/restore/list)
[ ] cert-directory.ts (upload/get/delete/search/getByUsername)
[ ] MnemonicDialog.tsx — 백업 옵션 추가
[ ] AuthDialog.tsx — 이메일 전용, Google 없음
[ ] AppShell.tsx — 사용자 영역
[ ] ContactsPage.tsx — 검색/키링 추가 (로그인 필수)
[ ] SettingsPage.tsx — 인증서 공유 섹션
[ ] App.tsx /contacts 라우트
[ ] BottomTabBar + SidebarNav Contacts 탭

검증:
[ ] 회원가입 → 인증 이메일 → 로그인
[ ] 니모닉 생성 + 백업 → 복구
[ ] 잘못된 백업 패스워드 → 오류
[ ] 인증서 업로드 → URL 생성
[ ] Contacts 검색 → 키링 추가
[ ] 비로그인 시 Contacts 검색 불가 확인
[ ] 비로그인 핵심 기능 정상 동작
```

---

## 16. 보안 원칙

```
서버 저장 OK:
  ✓ 이메일 (auth.users)
  ✓ 패스워드 해시 (Supabase 처리)
  ✓ 암호화된 니모닉 블롭 (AES-256-GCM)
  ✓ PBKDF2 salt, GCM IV (공개 파라미터)
  ✓ 힌트 텍스트
  ✓ 인증서 PEM (공개키 — 공개 정보)

서버 절대 금지:
  ✗ 니모닉 원문
  ✗ 백업 패스워드
  ✗ ML-KEM / ML-DSA / ECDSA 개인키
  ✗ AES 암호화 키
```
