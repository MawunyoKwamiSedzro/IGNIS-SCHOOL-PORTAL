import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async request => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
  if (request.method === 'OPTIONS') return new Response('ok', { headers });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return json({ error: 'Authentication required' }, 401);
  const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anon || !service) return json({ error: 'Account administration is not configured.' }, 500);
  const caller = createClient(url, anon, { global: { headers: { Authorization: authorization } } });
  const { data: { user }, error: authError } = await caller.auth.getUser();
  if (authError || !user) return json({ error: 'Invalid session.' }, 401);
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: callerProfile } = await admin.from('profiles').select('role, is_active').eq('user_id', user.id).maybeSingle();
  if (!callerProfile?.is_active || !['Headteacher', 'Manager'].includes(callerProfile.role)) return json({ error: 'Only active school administrators can manage accounts.' }, 403);
  let payload: { user_id?: string; is_active?: boolean; delete_user?: boolean };
  try { payload = await request.json(); } catch { return json({ error: 'Invalid request body.' }, 400); }
  const targetId = String(payload.user_id || '');
  const deleting = payload.delete_user === true;
  if (!targetId || (!deleting && typeof payload.is_active !== 'boolean')) return json({ error: 'Choose an account and action.' }, 400);
  if (targetId === user.id && (deleting || payload.is_active === false)) return json({ error: 'You cannot change or delete your own account.' }, 400);
  const { data: target } = await admin.from('profiles').select('user_id').eq('user_id', targetId).maybeSingle();
  if (!target) return json({ error: 'That account is not in the IGNIS directory.' }, 404);
  if (deleting) {
    const { error: deleteError } = await admin.auth.admin.deleteUser(targetId);
    if (deleteError) return json({ error: 'Account could not be deleted: ' + deleteError.message }, 500);
    return json({ user_id: targetId, deleted: true });
  }
  const { error: profileError } = await admin.from('profiles').update({ is_active: payload.is_active }).eq('user_id', targetId);
  if (profileError) return json({ error: 'Account status could not be saved.' }, 500);
  const { error: authUpdateError } = await admin.auth.admin.updateUserById(targetId, { ban_duration: payload.is_active ? 'none' : '876000h' });
  if (authUpdateError) {
    await admin.from('profiles').update({ is_active: !payload.is_active }).eq('user_id', targetId);
    return json({ error: 'Account sign-in status could not be updated.' }, 500);
  }
  return json({ user_id: targetId, is_active: payload.is_active });
});
