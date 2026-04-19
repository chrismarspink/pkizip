import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://ikyhpuerwljxypyzkpiw.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_X40NyHIx3u1qsFwLftTUuw_Ep4GE6l1';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
