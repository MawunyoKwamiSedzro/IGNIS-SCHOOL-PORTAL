/* Paste the new project's URL and publishable key here.
   This file is served to every visitor. Never put a secret/service-role key here. */
window.IGNIS_SUPABASE_CONFIG = {
    url: 'https://guyvqxfxxctlxstlbrqs.supabase.co',
    anonKey: 'sb_publishable_1r535hbDrkFJvkYd_5d6wg_5XXqkrr3'
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
