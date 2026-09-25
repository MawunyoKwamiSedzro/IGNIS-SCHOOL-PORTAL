# IGNIS Supabase setup and operations

The live portal is hosted with GitHub Pages from the repository root on the main branch.

- Portal: https://mawunyokwamisedzro.github.io/IGNIS-SCHOOL-PORTAL/
- Supabase project: fbrdwzwavtngsdhptutc

## Database

The deployed database schema is versioned at [../schema.sql](../schema.sql). For a new Supabase project, run that complete file in the SQL Editor. It creates the portal tables, indexes, helper functions, and row-level security policies. Never put a service-role key in browser code.

## Authentication

In Authentication settings:

1. Set the Site URL to the production portal URL.
2. Allow the production URL and its /reset-password.html redirect URL.
3. Keep public sign-up disabled. School accounts should be created by a Manager or Headteacher.
4. Supabase's default email sender is in use when custom SMTP is disabled. It is suitable for limited setup only: delivery is restricted to Supabase organization team addresses and is rate limited. Configure a verified custom SMTP provider before inviting school users broadly.

The current project already has its initial Manager profile. In a fresh project, create an Auth user, then add the matching row to public.profiles with its Auth UUID, email, full name, and role.

## Edge Functions

The deployed server-side functions have matching sources in this folder:

- functions/create-user/index.ts — administrator-only invitations and school profiles
- functions/set-user-status/index.ts — administrator-only account suspension and activation
- functions/clock-in/index.ts — Teacher attendance checks against approved geofences

Deploy or update them with the Supabase CLI:

- supabase login
- supabase link --project-ref fbrdwzwavtngsdhptutc
- supabase functions deploy create-user
- supabase functions deploy set-user-status
- supabase functions deploy clock-in

These functions validate the current Supabase Auth session and enforce role checks in the function. Keep privileged service keys in Supabase's server environment only.

## First-run school setup

The database starts without school records. Sign in as Manager, then configure the current academic term, arrival time, and school attendance geofence in School settings. Add classes and students before linking parent accounts. Add verified payment instructions before families use the fee pages. Staff attendance requires a configured geofence and the user's browser to grant location access.

The static site and Supabase database, Auth, and functions are live. Payment collection is recorded manually; automatic mobile-money checkout and notification delivery require separate provider integrations.
