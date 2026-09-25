const resetForm = document.getElementById('resetForm');
const resetMessage = document.getElementById('resetMessage');
const requestFreshLink = document.getElementById('requestFreshLink');
const passwordInput = document.getElementById('password');
const confirmPasswordInput = document.getElementById('confirmPassword');
const saveButton = resetForm.querySelector('button[type="submit"]');

function toggleVisibility(input, button) {
    input.type = input.type === 'password' ? 'text' : 'password';
    const visible = input.type === 'text';
    button.textContent = visible ? 'Hide' : 'Show';
    button.setAttribute('aria-pressed', String(visible));
}

document.getElementById('togglePassword').addEventListener('click', event => {
    toggleVisibility(passwordInput, event.currentTarget);
});
document.getElementById('toggleConfirmPassword').addEventListener('click', event => {
    toggleVisibility(confirmPasswordInput, event.currentTarget);
});

function showExpiredLinkMessage() {
    resetMessage.textContent = 'This password link has expired or was already used. Return to sign in and choose “Forgot password?” to request a fresh link.';
    requestFreshLink.hidden = false;
    resetForm.querySelectorAll('input, button[type="submit"]').forEach(control => {
        control.disabled = true;
    });
}

const query = new URLSearchParams(location.search);
if (query.has('error') || query.has('error_code')) {
    showExpiredLinkMessage();
}

resetForm.addEventListener('submit', async event => {
    event.preventDefault();
    resetMessage.textContent = '';
    const { client, error: setupError } = window.ignisSupabase || {};
    const values = new FormData(resetForm);
    const password = String(values.get('password') || '');
    const confirmation = String(values.get('confirmPassword') || '');

    if (!client) {
        resetMessage.textContent = setupError || 'Supabase is not configured.';
        return;
    }
    if (password.length < 10 || password !== confirmation) {
        resetMessage.textContent = 'Use at least 10 characters and make both passwords match.';
        return;
    }

    saveButton.disabled = true;
    const { data: { session }, error: sessionError } = await client.auth.getSession();
    if (sessionError || !session) {
        resetMessage.textContent = 'Your password link is invalid or expired. Return to sign in and choose “Forgot password?” to request a fresh link.';
        requestFreshLink.hidden = false;
        saveButton.disabled = false;
        return;
    }

    const { error } = await client.auth.updateUser({ password });
    if (error) {
        resetMessage.textContent = error.message;
        requestFreshLink.hidden = false;
        saveButton.disabled = false;
        return;
    }
    resetMessage.textContent = 'Password updated. You can now sign in.';
    setTimeout(() => location.replace('index.html'), 1200);
});
