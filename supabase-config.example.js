// IGNIS SCHOOL PORTAL - Supabase Configuration Template
// 1. Copy this file and rename it to: supabase-config.js
// 2. Fill your real values from Supabase -> Project Settings -> API
// 3. NEVER put service_role / secret key here - anon key only!

const SUPABASE_CONFIG = {
  url: "https://YOUR_PROJECT_REF.supabase.co",
  anonKey: "YOUR_SUPABASE_ANON_KEY_HERE"
};

// Do not edit below
if (typeof window !== 'undefined') {
  window.SUPABASE_CONFIG = SUPABASE_CONFIG;
}

// For ES modules
// export default SUPABASE_CONFIG;
