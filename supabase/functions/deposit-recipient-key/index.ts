/**
 * deposit-recipient-key — 점진적 신뢰: 수신자 공개키를 봉투의 NULL 슬롯에 1회 write.
 *
 * 익명 허용으로 배포(수신자는 로그인 불필요):
 *   supabase functions deploy deposit-recipient-key --no-verify-jwt
 *
 * 요청(POST, anon): { token, publicKeyJwk, fingerprint, proof }
 * 응답: { ok: true }  (409 = 이미 채워짐, 410/404 = 만료·부재)
 *
 * 서버는 OTC 를 모르므로 proof 를 검증하지 못하고 그대로 보관한다.
 * 발송자가 OTC 로 proof 를 재검증해 승급 여부를 결정(가짜 키 거부).
 * NULL 슬롯 단일 write + 유효 토큰 + JWK 스키마 검증 + 크기 제한으로 남용 억제.
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
  const { token, publicKeyJwk, fingerprint, proof } = body ?? {};

  if (!token || String(token).length > 512) return jsonError('bad token', 400);
  if (!/^[0-9a-f]{8,64}$/.test(String(fingerprint ?? ''))) return jsonError('bad fingerprint', 400);
  if (typeof proof !== 'string' || proof.length !== 64 || !/^[0-9a-f]+$/.test(proof)) return jsonError('bad proof', 400);
  // ECDH P-256 공개키 JWK 스키마 검증 (개인키 필드 d 는 금지)
  const jwk = publicKeyJwk;
  if (!jwk || jwk.kty !== 'EC' || jwk.crv !== 'P-256' || typeof jwk.x !== 'string' || typeof jwk.y !== 'string' || 'd' in jwk) {
    return jsonError('bad publicKeyJwk', 400);
  }
  if (JSON.stringify(jwk).length > 2048) return jsonError('jwk too large', 400);

  const tokenHash = await sha256hex(String(token));

  const url = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const svc = createClient(url, serviceKey);

  const { data, error } = await svc.rpc('deposit_recipient_key', {
    p_token_hash: tokenHash,
    p_pubkey: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y },
    p_fingerprint: fingerprint,
    p_proof: proof,
  });
  if (error) return jsonError('server error', 500);
  const ok = Array.isArray(data) ? data.length > 0 : !!data;
  if (!ok) return jsonError('slot unavailable', 409); // 이미 채워짐 / 만료 / 부재

  return json({ ok: true });
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
