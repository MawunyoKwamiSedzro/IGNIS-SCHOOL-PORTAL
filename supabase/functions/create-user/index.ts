import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return json({ error: 'Authentication required' }, 401);

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anonKey || !serviceKey) return json({ error: 'User provisioning is not configured.' }, 500);

  const caller = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
  const { data: { user }, error: authError } = await caller.auth.getUser();
  if (authError || !user) return json({ error: 'Invalid session.' }, 401);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: callerProfile } = await admin.from('profiles').select('role, is_active').eq('user_id', user.id).maybeSingle();
  if (!callerProfile?.is_active || !['Headteacher', 'Manager'].includes(callerProfile.role)) {
    return json({ error: 'Only school administrators can create accounts.' }, 403);
  }

  let payload: { email?: string; full_name?: string; role?: string; linked_student_id?: string | null };
  try { payload = await request.json(); } catch { return json({ error: 'Invalid request body.' }, 400); }
  const email = String(payload.email || '').trim().toLowerCase();
  const fullName = String(payload.full_name || '').trim();
  const role = String(payload.role || '');
  const validRoles = ['Headteacher', 'Manager', 'Teacher', 'Parent', 'Parent / Student', 'Student'];
  const linkedStudentId = payload.linked_student_id ? String(payload.linked_student_id) : null;

  if (!email.includes('@') || !fullName || !validRoles.includes(role)) return json({ error: 'Enter a valid name, email, and role.' }, 400);
  if (['Parent', 'Parent / Student'].includes(role) && !linkedStudentId) return json({ error: 'Choose a student for this parent account.' }, 400);
  if (linkedStudentId) {
    const { data: student } = await admin.from('students').select('id').eq('id', linkedStudentId).maybeSingle();
    if (!student) return json({ error: 'The selected student does not exist.' }, 400);
  }

  const { data: invite, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { full_name: fullName },
  });
  if (inviteError || !invite.user) return json({ error: inviteError?.message || 'Could not send the account invitation.' }, 400);

  const { error: profileError } = await admin.from('profiles').upsert({
    user_id: invite.user.id,
    email,
    full_name: fullName,
    role,
    linked_student_id: linkedStudentId,
  });
  if (profileError) {
    await admin.auth.admin.deleteUser(invite.user.id);
    return json({ error: 'Invitation could not be connected to a school profile.' }, 500);
  }

  if (linkedStudentId && ['Parent', 'Parent / Student'].includes(role)) {
    const { error: linkError } = await admin.from('parent_student_links').upsert({ parent_user_id: invite.user.id, student_id: linkedStudentId });
    if (linkError) return json({ error: 'The user was invited, but the student link could not be saved.' }, 500);
  }

  return json({ user_id: invite.user.id, email, invitation_sent: true }, 201);
});
