/* Public Supabase project settings. Never place a secret key in browser code. */
window.IGNIS_SUPABASE_CONFIG = {
    url: 'https://fbrdwzwavtngsdhptutc.supabase.co',
    anonKey: 'sb_publishable_4Pwm_MhR9PhszRqJv8riWw_Ym5lz5S7'
};

window.ignisSupabase = (() => {
    const { url, anonKey } = window.IGNIS_SUPABASE_CONFIG;
    if (!url || !anonKey || !window.supabase?.createClient) {
        return { client: null, error: 'Supabase settings are missing. Follow supabase/SETUP.md.' };
    }
    return { client: window.supabase.createClient(url, anonKey), error: null };
})();
