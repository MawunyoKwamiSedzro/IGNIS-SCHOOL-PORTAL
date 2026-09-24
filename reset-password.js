const resetForm = document.getElementById('resetForm');
const resetMessage = document.getElementById('resetMessage');
resetForm.addEventListener('submit', async event => {
    event.preventDefault();
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
    const button = resetForm.querySelector('button[type="submit"]');
    button.disabled = true;
    const { error } = await client.auth.updateUser({ password });
    if (error) {
        resetMessage.textContent = error.message;
        button.disabled = false;
        return;
    }
    resetMessage.textContent = 'Password updated. You can now sign in.';
    setTimeout(() => location.replace('index.html'), 1200);
});
