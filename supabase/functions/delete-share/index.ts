/**
 * delete-share — 발송자 봉투 폐기: 행 + blob 삭제.
 *
 * JWT 검증 ON 으로 배포(소유자만):
 *   supabase functions deploy delete-share
 *
 * 요청(POST, Authorization: Bearer): { envelopeId }
 * 응답: { ok: true }
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

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return jsonError('unauthorized', 401);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) return jsonError('unauthorized', 401);

  let body: any;
  try { body = await req.json(); } catch { return jsonError('bad json', 400); }
  const envelopeId = String(body?.envelopeId ?? '');
  if (!envelopeId) return jsonError('missing envelopeId', 400);

  const svc = createClient(url, serviceKey);
  const { data: row, error: selErr } = await svc
    .from('shared_envelopes').select('blob_path, owner_id').eq('id', envelopeId).single();
  if (selErr || !row || row.owner_id !== user.id) return jsonError('not found', 404);

  await svc.storage.from('envelopes').remove([row.blob_path]);
  await svc.from('shared_envelopes').delete().eq('id', envelopeId);

  return json({ ok: true });
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
