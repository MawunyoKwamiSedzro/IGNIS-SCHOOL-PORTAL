/* IGNIS authentication uses Supabase Auth. */
const form = document.getElementById('loginForm');
const passwordInput = document.getElementById('password');
const togglePassword = document.getElementById('togglePassword');
const forgotPassword = document.getElementById('forgotPassword');
const loginError = document.getElementById('loginError');

const showError = message => {
    loginError.textContent = message;
    loginError.classList.add('show');
};

if (!window.ignisSupabase?.client) {
    showError(window.ignisSupabase?.error || 'Supabase settings are missing. Follow supabase/SETUP.md.');
}

togglePassword.addEventListener('click', () => {
    passwordInput.type = passwordInput.type === 'password' ? 'text' : 'password';
    togglePassword.textContent = passwordInput.type === 'password' ? 'Show' : 'Hide';
});

form.addEventListener('submit', async event => {
    event.preventDefault();
    loginError.textContent = '';
    const { client, error: setupError } = window.ignisSupabase || {};
    if (!client) {
        showError(setupError || 'IGNIS is not connected to Supabase yet. Complete the setup in supabase/SETUP.md.');
        return;
    }

    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    submit.textContent = 'Signing in…';
    const email = String(new FormData(form).get('email') || '').trim().toLowerCase();
    const password = String(new FormData(form).get('password') || '');

    try {
        const { data, error } = await client.auth.signInWithPassword({ email, password });
        if (error) throw error;

        const { data: profile, error: profileError } = await client
            .from('profiles')
            .select('full_name, role, linked_student_id, is_active')
            .eq('user_id', data.user.id)
            .single();
        if (profileError || !profile) throw new Error('Your account is not set up in the IGNIS school directory. Contact the school administrator.');
        if (!profile.is_active) throw new Error('This account is disabled. Contact the school administrator.');

        sessionStorage.setItem('ignis-session', JSON.stringify({
            id: data.user.id,
            email: data.user.email,
            name: profile.full_name,
            role: profile.role,
            wardId: profile.linked_student_id || undefined,
            initials: profile.full_name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0].toUpperCase()).join('')
        }));
        location.replace('dashboard.html');
    } catch (error) {
        await client.auth.signOut();
        showError(error.message || 'Sign in failed. Check your details and try again.');
    } finally {
        submit.disabled = false;
        submit.textContent = 'Sign in securely';
    }
});

forgotPassword.addEventListener('click', async () => {
    const { client, error: setupError } = window.ignisSupabase || {};
    const email = String(document.getElementById('email').value || '').trim().toLowerCase();
    if (!email) {
        showError('Enter your email address first, then choose Forgot password.');
        return;
    }
    if (!client) {
        showError(setupError || 'IGNIS is not connected to Supabase yet.');
        return;
    }
    const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/reset-password.html` });
    if (error) showError(error.message);
    else showError('If that address belongs to an account, password reset instructions have been sent.');
});
