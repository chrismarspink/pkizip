/**
 * fetch-envelope — 무설치 열람: 토큰으로 게이트 통과 시 단명 서명 다운로드 URL 발급.
 *
 * 익명 허용으로 배포(수신자는 로그인 불필요):
 *   supabase functions deploy fetch-envelope --no-verify-jwt
 *
 * 요청(POST, anon): { token }
 * 응답: { signedUrl, sizeBytes, hasRecipientSlot }
 *
 * 게이트(만료·소진·폐기)는 SECURITY DEFINER RPC claim_envelope_download 가 원자적으로 강제.
 * 실패는 만료·소진·부재 구분 없이 동일 404 → 존재 추론 차단.
 * signedUrl 은 60초 TTL. OTC(복호화)는 서버에 오지 않는다.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return jsonError('method not allowed', 405);

  let body: any;
  try { body = await req.json(); } catch { return jsonError('bad json', 400); }
  const token = String(body?.token ?? '');
  if (!token || token.length > 512) return jsonError('missing token', 400);

  const tokenHash = await sha256hex(token);

  const url = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const svc = createClient(url, serviceKey);

  const { data, error } = await svc.rpc('claim_envelope_download', { p_token_hash: tokenHash });
  if (error) return jsonError('server error', 500);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return jsonError('not found', 404);   // 만료·소진·부재 동일 응답

  const { data: signed, error: sErr } = await svc.storage.from('envelopes').createSignedUrl(row.blob_path, 60);
  if (sErr || !signed) return jsonError('server error', 500);

  return json({ signedUrl: signed.signedUrl, sizeBytes: row.size_bytes, hasRecipientSlot: row.has_recipient_slot });
});

async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
