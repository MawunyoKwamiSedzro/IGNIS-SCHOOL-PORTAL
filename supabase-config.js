/* Public Supabase project settings. Never place a service_role key in this file. */
window.IGNIS_SUPABASE_CONFIG = {
    url: '',
    anonKey: ''
};

window.ignisSupabase = (() => {
    const { url, anonKey } = window.IGNIS_SUPABASE_CONFIG;
    if (!url || !anonKey || !window.supabase?.createClient) {
        return { client: null, error: 'Supabase settings are missing. Follow supabase/SETUP.md.' };
    }
    return { client: window.supabase.createClient(url, anonKey), error: null };
})();
