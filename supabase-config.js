/* Public Supabase project settings. Never place a secret key in browser code. */
window.IGNIS_SUPABASE_CONFIG = {
    url: 'https://fbrdwzwavtngsdhptutc.supabase.co',
    anonKey: 'sb_publishable_4Pwm_MhR9PhszRqJv8riWw_Ym5lz5S7'
};

if (!window.IGNIS_SUPABASE_CONFIG.url || !window.IGNIS_SUPABASE_CONFIG.anonKey) {
    window.ignisSupabase = { client: null, error: 'Supabase settings are missing. Follow supabase/SETUP.md.' };
} else if (!window.supabase?.createClient) {
    window.ignisSupabase = { client: null, error: 'The Supabase browser library did not load. Refresh the page or check network access to jsDelivr.' };
} else {
    window.ignisSupabase = {
        client: window.supabase.createClient(window.IGNIS_SUPABASE_CONFIG.url, window.IGNIS_SUPABASE_CONFIG.anonKey),
        error: null
    };
}
