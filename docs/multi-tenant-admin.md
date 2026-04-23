# pkizip 조직 관리자 페이지 설계 (확장판)

> 기존 /team/:slug 단일 페이지(탭 5개)를 **풀-사이드바 + 중첩 라우트** 구조로 재설계
> 작성일: 2026-04-23

---

## 1. 목표

- 엔터프라이즈 수준의 조직 관리 콘솔
- **공용 주소록**(조직 내 멤버 + 외부 거래처) 큐레이션 — 가장 핵심 신규 가치
- 멤버는 자기 개인 키링과 별개로 조직 주소록을 한눈에 조회·임포트
- 모든 변경은 감사 로그에 기록

---

## 2. 라우트 구조 (중첩)

```
/team/:slug                       대시보드 (실시간 통계)
  /members                        멤버 목록 + 역할 변경/제거 (기존)
  /invites                        초대 발송/취소 (기존)
  /contacts                       ★ 공용 주소록 — 신규
    ?category=member|partner|all
    /:contactId                   단건 상세/편집
    /new                          신규 등록
  /policies                       보안 정책 (기존)
  /audit                          감사 로그 (기존, 필터 추가)
  /billing                        결제/플랜 (기존)
  /settings                       조직 메타 (이름·슬러그·로고) — 신규
```

route-level 가드: TeamLayout이 `getTenantBySlug` + `listMembers`로 myRole 결정 후 children에 props로 전달.

---

## 3. 레이아웃

```
┌─ 사이드바(220px 고정) ────────────┬─ 콘텐츠 ─────────────┐
│ [로고]                            │ [breadcrumb]          │
│ 조직: 회사 키 ▼ (스위처)           │                       │
│                                   │   페이지 콘텐츠         │
│ 일반                              │                       │
│   📊 대시보드                     │                       │
│ 사용자                            │                       │
│   👥 멤버                         │                       │
│   ✉ 초대                         │                       │
│   📒 공용 주소록                   │                       │
│ 보안                              │                       │
│   🛡 정책                         │                       │
│   📜 감사 로그                    │                       │
│ 운영                              │                       │
│   ⚙ 설정                         │                       │
│   💳 결제                         │                       │
│                                   │                       │
│ [← 워크스페이스로]                  │                       │
└───────────────────────────────────┴───────────────────────┘
```

- 모바일: 사이드바 → 햄버거 + 드로어
- 권한별 메뉴 노출: member는 대시보드/공용주소록만, admin은 전부 -billing, owner는 전부

---

## 4. 공용 주소록 (핵심)

### 4.1 데이터 모델

```sql
CREATE TABLE tenant_address_book (
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
  -- 인증서 (선택적)
  fingerprint text,
  cert_classic text,
  cert_kem text,
  cert_dsa text,
  enc_jwk_classic jsonb,
  logotype text,           -- data URL (png/jpeg)
  -- 외부 사용자 연동 (member 카테고리일 때 user_id 채움)
  linked_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  source text DEFAULT 'manual' CHECK (source IN ('manual','imported','linked_user')),
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_addr_tenant_category ON tenant_address_book(tenant_id, category);
CREATE INDEX idx_addr_tenant_name ON tenant_address_book(tenant_id, display_name);
CREATE INDEX idx_addr_tenant_fp ON tenant_address_book(tenant_id, fingerprint);
ALTER TABLE tenant_address_book ENABLE ROW LEVEL SECURITY;

-- RLS
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
```

### 4.2 UI 흐름

**목록**:
```
┌─ 검색바 + [카테고리 칩] [태그 필터] [+ 신규]  [CSV 내보내기]
├─ 카드 그리드 / 표 토글
│   ┌────────────────────┐
│   │ [logo] 홍길동       │
│   │ hong@company.com   │
│   │ 영업팀 · 부장        │
│   │ [member]           │
│   │ [Add to keyring]   │
│   └────────────────────┘
```

**상세/편집 (Sheet)**:
- 기본 정보 + 인증서 첨부(PEM 업로드 or 인증서 디렉토리 검색해 가져오기)
- 멤버 카테고리: tenant_members와 자동 동기화 (linked_user_id 사용)
- 외부 거래처: 수동 입력만

**가져오기 (Import)**:
- Member: `/team/:slug/members`에서 멤버를 자동으로 주소록에 추가하는 토글
- Partner: 다른 조직의 cert_bundles에서 검색해 가져오기 또는 PEM 직접 입력

**키링 추가**:
- "내 주소록에 추가" 버튼 → 사용자의 IndexedDB keyring에 복사

### 4.3 멤버 자동 동기화 (옵션)

- tenant_members INSERT/DELETE 트리거 → tenant_address_book 자동 추가/삭제
- profiles.display_name과 sync
- 멤버가 자신의 cert_bundle을 업로드하면 주소록에도 반영
- 일단 수동으로 시작, 추후 트리거화

---

## 5. 대시보드 (홈)

```
┌─ 환영 카드 (조직명, 플랜, 사용량 게이지) ─┐
│
├─ 4-카드 통계 (수직 lg, 가로 모바일)
│   [👥 멤버 12]  [📒 주소록 47]
│   [📜 이번달 활동 132건]  [🛡 정책 위반 0건]
│
├─ 최근 활동 (audit_logs 최근 10개)
│
├─ 빠른 액션
│   [+ 멤버 초대] [+ 거래처 추가] [정책 검토] [감사 보기]
```

---

## 6. 설정 (`/settings`)

- 조직 이름 / slug (변경 시 라우트 리다이렉트)
- 조직 로고 (PNG 업로드, 사이드바·이메일에 사용)
- 도메인 화이트리스트 (가입 자동 승인용 — enterprise)
- 위험 구역: 조직 삭제

---

## 7. 시스템 관리(`/admin`) 동시 보강

- 동일 사이드바 패턴
- 추가:
  - **System Address Book** — 모든 테넌트가 조회 가능한 글로벌 거래처 (옵션, sysadmin만)
  - **사용량 모니터링** — 테넌트별 daily activity
  - **3rd Party 인증서** — TSA, CA, Root, Intermediate 카탈로그 관리 (이미 third_party_certs 있음)

---

## 8. 구현 순서

1. **이 문서**(`docs/multi-tenant-admin.md`)
2. **SQL 마이그레이션**: `tenant_address_book` + RLS + grants
3. **API 헬퍼**: `lib/supabase/address-book.ts`
4. **라우트 재구성**: `App.tsx` 중첩 라우트 + `TeamLayout` 컴포넌트
5. **TeamLayout** + Sidebar
6. **TeamDashboardPage** — 통계 카드
7. **TeamContactsPage** — 목록/검색/필터/CRUD/Import
8. **TeamSettingsPage** — 메타 편집
9. 기존 멤버/초대/정책/감사/결제 → 별 컴포넌트로 분리
10. 빌드 + 배포

---

## 9. 향후 과제

- 멤버↔주소록 자동 동기 트리거
- CSV import/export (OpenAddressBook 같은 포맷)
- vCard / LDAP 연동
- 인증서 만료 알림
- 조직 도메인 인증 (DNS TXT)
- 외부 거래처 초대(=조직 소속이 아닌 인증서 발급 + 제한 권한)
