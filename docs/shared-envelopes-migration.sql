-- ════════════════════════════════════════════════════════════════════
-- 안전 링크 발송 (shared_envelopes) — Supabase 콘솔 SQL Editor 에서 실행
--
-- 신뢰 모델: 서버는 암호문 blob 과 비밀 없는 메타(해시·만료·카운터)만 보유.
--   - 복호화 비밀(OTC)·키·평문·원본 파일명은 저장하지 않는다.
--   - 접근 토큰은 원형 저장 안 함 — SHA-256 해시만(DB 유출로 링크 재구성 불가).
--   - anon 은 이 테이블/스토리지에 대한 정책이 전무 → 열거·추론 불가.
--     모든 anon 상호작용은 서비스 롤 Edge Function 경유(원자적 게이트).
--
-- 함께 적용할 것:
--   1) 이 SQL (테이블 + RLS + RPC)
--   2) Storage 비공개 버킷 'envelopes' 생성 (Dashboard → Storage → New bucket, Public 끄기)
--      → storage.objects 에 anon/authenticated 정책은 만들지 않는다.
--   3) Edge Functions 배포:
--      supabase functions deploy create-share            (JWT 검증 ON)
--      supabase functions deploy delete-share            (JWT 검증 ON)
--      supabase functions deploy fetch-envelope --no-verify-jwt
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.shared_envelopes (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash              TEXT NOT NULL UNIQUE,          -- hex(sha256(access_token))
  blob_path               TEXT NOT NULL,                 -- {owner_id}/{uuid} — 토큰과 분리
  size_bytes              BIGINT NOT NULL,
  content_hash            TEXT,                          -- hex(sha256(ciphertext)) 무결성(옵션)
  owner_id                UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at              TIMESTAMPTZ NOT NULL,
  max_downloads           INT NOT NULL DEFAULT 1 CHECK (max_downloads BETWEEN 1 AND 100),
  download_count          INT NOT NULL DEFAULT 0,
  revoked_at              TIMESTAMPTZ,
  -- 점진적 신뢰(Phase 2): 수신자 공개키 슬롯 (처음 NULL, 1회 write)
  recipient_pubkey        JSONB,
  recipient_fingerprint   TEXT,
  recipient_deposit_proof TEXT,
  deposited_at            TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_envelopes_owner   ON public.shared_envelopes (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_envelopes_expires ON public.shared_envelopes (expires_at);

-- ── RLS ──────────────────────────────────────────────────────────────
ALTER TABLE public.shared_envelopes ENABLE ROW LEVEL SECURITY;

-- 발송자는 자기 봉투만 조회(대시보드 + Phase 2 공개키 회수)
DROP POLICY IF EXISTS "envelope_owner_select" ON public.shared_envelopes;
CREATE POLICY "envelope_owner_select" ON public.shared_envelopes
  FOR SELECT USING (owner_id = auth.uid());

-- 발송자는 자기 봉투만 삭제(폐기)
DROP POLICY IF EXISTS "envelope_owner_delete" ON public.shared_envelopes;
CREATE POLICY "envelope_owner_delete" ON public.shared_envelopes
  FOR DELETE USING (owner_id = auth.uid());

-- INSERT/UPDATE 정책 없음 → 클라이언트(anon/auth) 직접 삽입·갱신 불가.
-- 삽입(create-share)·카운터 증가(claim_envelope_download)·슬롯 write(deposit)는
-- 전부 서비스 롤 Edge Function / SECURITY DEFINER RPC 가 수행(RLS 우회).

-- ── 원자적 다운로드 게이트 (fetch-envelope 가 호출) ───────────────────
-- 만료·소진·폐기를 원자적으로 확인 + 카운터 증가. 통과 시 blob_path 반환.
-- 실패(만료/소진/부재)는 모두 0행 → 호출 측이 동일 응답으로 존재 추론 차단.
CREATE OR REPLACE FUNCTION public.claim_envelope_download(p_token_hash TEXT)
RETURNS TABLE (blob_path TEXT, size_bytes BIGINT, has_recipient_slot BOOLEAN)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.shared_envelopes e
     SET download_count = e.download_count + 1
   WHERE e.token_hash = p_token_hash
     AND e.revoked_at IS NULL
     AND now() < e.expires_at
     AND e.download_count < e.max_downloads
  RETURNING e.blob_path, e.size_bytes, (e.recipient_pubkey IS NULL);
$$;

-- RPC 는 서비스 롤에서만 호출(Edge Function). anon/auth 직접 실행 차단.
REVOKE ALL ON FUNCTION public.claim_envelope_download(TEXT) FROM PUBLIC, anon, authenticated;

-- ── (Phase 2) 수신자 공개키 deposit — NULL 슬롯 1회 write ──────────────
CREATE OR REPLACE FUNCTION public.deposit_recipient_key(
  p_token_hash TEXT, p_pubkey JSONB, p_fingerprint TEXT, p_proof TEXT
)
RETURNS TABLE (ok BOOLEAN)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.shared_envelopes e
     SET recipient_pubkey = p_pubkey,
         recipient_fingerprint = p_fingerprint,
         recipient_deposit_proof = p_proof,
         deposited_at = now()
   WHERE e.token_hash = p_token_hash
     AND e.recipient_pubkey IS NULL
     AND e.revoked_at IS NULL
     AND now() < e.expires_at
  RETURNING TRUE;
$$;

REVOKE ALL ON FUNCTION public.deposit_recipient_key(TEXT, JSONB, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
