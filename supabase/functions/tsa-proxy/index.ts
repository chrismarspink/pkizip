/**
 * tsa-proxy — RFC 3161 TSA 호출 CORS 우회 프록시 (Supabase Edge Function)
 *
 * 브라우저는 공개 TSA(DigiCert/Sectigo/GlobalSign/FreeTSA)에 직접 fetch 시
 * CORS 차단됨. 이 Edge Function이 application/timestamp-query 바이너리를
 * 그대로 받아 TSA에 POST하고, application/timestamp-reply를 그대로 반환.
 *
 * 배포:
 *   supabase functions deploy tsa-proxy --no-verify-jwt
 *
 * 호출:
 *   POST https://<project>.functions.supabase.co/tsa-proxy
 *   Header: x-tsa-url: https://timestamp.digicert.com
 *   Header: Content-Type: application/timestamp-query
 *   Body: <DER bytes>
 */

const ALLOWED_TSA_HOSTS = new Set([
  'timestamp.digicert.com',
  'timestamp.sectigo.com',
  'timestamp.globalsign.com',
  'freetsa.org',
  'rfc3161timestamp.globalsign.com',
  // 필요 시 추가
]);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-tsa-url',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
  }

  const tsaUrl = req.headers.get('x-tsa-url');
  if (!tsaUrl) {
    return jsonError('missing x-tsa-url header', 400);
  }

  let parsed: URL;
  try { parsed = new URL(tsaUrl); }
  catch { return jsonError('invalid x-tsa-url', 400); }

  if (!ALLOWED_TSA_HOSTS.has(parsed.hostname)) {
    return jsonError(`host not allowed: ${parsed.hostname}`, 403);
  }

  const reqBody = new Uint8Array(await req.arrayBuffer());
  if (reqBody.length === 0 || reqBody.length > 16 * 1024) {
    return jsonError('invalid body size', 400);
  }

  try {
    const upstream = await fetch(tsaUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/timestamp-query' },
      body: reqBody,
      signal: AbortSignal.timeout(10_000),
    });

    if (!upstream.ok) {
      return jsonError(`tsa upstream ${upstream.status}`, 502);
    }

    const ct = upstream.headers.get('content-type') ?? 'application/timestamp-reply';
    const buf = await upstream.arrayBuffer();
    return new Response(buf, {
      headers: {
        ...corsHeaders,
        'Content-Type': ct,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : 'fetch failed', 502);
  }
});

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
