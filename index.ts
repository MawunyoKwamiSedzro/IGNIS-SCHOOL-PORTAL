import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const distanceMeters = (aLat: number, aLng: number, bLat: number, bLng: number) => {
  const radians = (value: number) => value * Math.PI / 180;
  const dLat = radians(bLat - aLat);
  const dLng = radians(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(aLat)) * Math.cos(radians(bLat)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};

Deno.serve(async request => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
  if (request.method === 'OPTIONS') return new Response('ok', { headers });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return json({ error: 'Sign in first.' }, 401);
  const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anon || !service) return json({ error: 'Attendance service is not configured.' }, 500);

  const userClient = createClient(url, anon, { global: { headers: { Authorization: authorization } } });
  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) return json({ error: 'Invalid session.' }, 401);
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: profile } = await admin.from('profiles').select('role, full_name, is_active').eq('user_id', user.id).maybeSingle();
  if (!profile?.is_active || profile.role !== 'Teacher') return json({ error: 'Only active teaching staff can record staff attendance.' }, 403);

  let coordinates: { latitude?: number; longitude?: number };
  try { coordinates = await request.json(); } catch { return json({ error: 'Invalid location data.' }, 400); }
  const latitude = Number(coordinates.latitude);
  const longitude = Number(coordinates.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    return json({ error: 'A valid device location is required.' }, 400);
  }

  const { data: zones, error: zoneError } = await admin.from('geofences').select('id, name, latitude, longitude, radius_meters').eq('enabled', true);
  if (zoneError) return json({ error: 'Could not load approved attendance locations.' }, 500);
  const match = (zones || []).map(zone => ({ zone, distance: distanceMeters(latitude, longitude, zone.latitude, zone.longitude) }))
    .sort((a, b) => a.distance - b.distance)[0];
  if (!match || match.distance > match.zone.radius_meters) {
    return json({ error: match ? 'You are ' + Math.round(match.distance) + 'm from ' + match.zone.name + '; its limit is ' + match.zone.radius_meters + 'm.' : 'No approved school attendance location is configured.' }, 403);
  }

  const now = new Date();
  const day = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const { data: arrival } = await admin.from('school_settings').select('setting_value').eq('setting_key', 'arrival_by').maybeSingle();
  const arrivalBy = String(arrival?.setting_value?.time || '08:00');
  const [hours, minutes] = arrivalBy.split(':').map(Number);
  const lateAt = new Date(now);
  lateAt.setHours(hours, minutes, 0, 0);
  const status = now > lateAt ? 'late' : 'present';

  const { error: insertError } = await admin.from('staff_attendance').insert({
    staff_user_id: user.id,
    attendance_date: day,
    status,
    recorded_at: now.toISOString(),
    latitude,
    longitude,
    zone_name: match.zone.name,
    distance_meters: Math.round(match.distance),
  });
  if (insertError) return json({ error: insertError.code === '23505' ? 'Your attendance is already recorded for today.' : 'Attendance could not be saved.' }, 409);
  return json({ status, recorded_at: now.toISOString(), zone_name: match.zone.name, distance_meters: Math.round(match.distance) }, 201);
});
