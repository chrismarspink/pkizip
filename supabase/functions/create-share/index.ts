/**
 * create-share — 안전 링크 발송: 봉투 행 삽입 + 서명 업로드 URL 발급.
 *
 * JWT 검증 ON 으로 배포(발송자 로그인 필수):
 *   supabase functions deploy create-share
 *
 * 요청(POST, Authorization: Bearer <sb access token>):
 *   { tokenHash: hex(sha256(token)), sizeBytes, contentHash?, expiresAt(ISO), maxDownloads }
 * 응답:
 *   { envelopeId, blobPath, upload: { path, token } }   // uploadToSignedUrl 용
 *
 * 서버는 OTC·복호화 키·파일명을 받지 않는다. blob_path 는 서버가 정한다(경로 위조 방지).
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_BLOB_BYTES = 50 * 1024 * 1024;   // 50MB 상한
const MAX_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000; // 최대 30일

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return jsonError('method not allowed', 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return jsonError('unauthorized', 401);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // JWT 로 사용자 확인
  const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) return jsonError('unauthorized', 401);

  let body: any;
  try { body = await req.json(); } catch { return jsonError('bad json', 400); }
  const { tokenHash, sizeBytes, contentHash, expiresAt, maxDownloads } = body ?? {};

  if (!/^[0-9a-f]{64}$/.test(String(tokenHash ?? ''))) return jsonError('bad tokenHash', 400);
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_BLOB_BYTES) return jsonError('bad size', 400);
  const md = Math.min(100, Math.max(1, Math.floor(Number(maxDownloads) || 1)));
  const exp = Date.parse(String(expiresAt ?? ''));
  if (!Number.isFinite(exp) || exp <= Date.now() || exp - Date.now() > MAX_EXPIRY_MS) {
    return jsonError('bad expiresAt', 400);
  }
  if (contentHash != null && !/^[0-9a-f]{64}$/.test(String(contentHash))) return jsonError('bad contentHash', 400);

  const svc = createClient(url, serviceKey);
  const blobPath = `${user.id}/${crypto.randomUUID()}`;

  const { data: ins, error: insErr } = await svc.from('shared_envelopes').insert({
    token_hash: tokenHash,
    blob_path: blobPath,
    size_bytes: sizeBytes,
    content_hash: contentHash ?? null,
    owner_id: user.id,
    expires_at: new Date(exp).toISOString(),
    max_downloads: md,
  }).select('id').single();
  if (insErr) return jsonError(insErr.message, insErr.code === '23505' ? 409 : 400);

  const { data: up, error: upErr } = await svc.storage.from('envelopes').createSignedUploadUrl(blobPath);
  if (upErr || !up) {
    // 업로드 URL 발급 실패 시 방금 만든 행 롤백
    await svc.from('shared_envelopes').delete().eq('id', ins.id);
    return jsonError(upErr?.message ?? 'upload url failed', 500);
  }

  return json({ envelopeId: ins.id, blobPath, upload: { path: up.path, token: up.token } });
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
