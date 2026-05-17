// Auth page logic
document.addEventListener('DOMContentLoaded', () => {
    if (redirectIfLoggedIn()) return;

    const tabs = document.querySelectorAll('.auth-tab');
    const indicator = document.querySelector('.auth-tab-indicator');
    const loginPanel = document.getElementById('loginPanel');
    const signupPanel = document.getElementById('signupPanel');
    const loginForm = document.getElementById('loginForm');
    const signupForm = document.getElementById('signupForm');
    const signupPassword = document.getElementById('signupPassword');

    // Tab switching
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.dataset.tab;
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            if (target === 'signup') {
                indicator.classList.add('signup');
                loginPanel.classList.remove('active');
                signupPanel.classList.add('active');
            } else {
                indicator.classList.remove('signup');
                signupPanel.classList.remove('active');
                loginPanel.classList.add('active');
            }
        });
    });

    // Check URL hash
    if (window.location.hash === '#signup') {
        tabs[1].click();
    }

    // Password strength
    if (signupPassword) {
        signupPassword.addEventListener('input', () => {
            const val = signupPassword.value;
            const bars = document.querySelectorAll('.password-strength-bar');
            const text = document.querySelector('.password-strength-text');
            let strength = 0;
            if (val.length >= 6) strength++;
            if (val.length >= 8 && /[A-Z]/.test(val)) strength++;
            if (/[0-9]/.test(val) && /[^A-Za-z0-9]/.test(val)) strength++;

            bars.forEach((bar, i) => {
                bar.className = 'password-strength-bar';
                if (i < strength) {
                    bar.classList.add(strength === 1 ? 'active-weak' : strength === 2 ? 'active-medium' : 'active-strong');
                }
            });
            const labels = ['', 'Weak', 'Medium', 'Strong'];
            if (text) text.textContent = val.length > 0 ? labels[strength] || 'Too short' : '';
        });
    }

    // Password toggle
    document.querySelectorAll('.password-toggle').forEach(btn => {
        btn.addEventListener('click', () => {
            const input = btn.parentElement.querySelector('input');
            const isPassword = input.type === 'password';
            input.type = isPassword ? 'text' : 'password';
            btn.textContent = isPassword ? '🙈' : '👁';
        });
    });

    // Login form
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = loginForm.querySelector('.auth-submit');
        const email = document.getElementById('loginEmail').value.trim();
        const password = document.getElementById('loginPassword').value;

        clearErrors(loginForm);
        if (!email) return showFieldError('loginEmail', 'Email is required');
        if (!password) return showFieldError('loginPassword', 'Password is required');

        btn.disabled = true;
        btn.innerHTML = '<div class="spinner"></div> Signing in...';

        try {
            const data = await apiFetch('/auth/login', {
                method: 'POST',
                body: JSON.stringify({ email, password })
            });
            setToken(data.token);
            setUser(data.user);
            showToast('Login successful!', 'success');
            setTimeout(() => window.location.href = 'dashboard.html', 500);
        } catch (err) {
            showToast(err.message, 'error');
            btn.disabled = false;
            btn.innerHTML = 'Sign In';
        }
    });

    // Signup form
    signupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = signupForm.querySelector('.auth-submit');
        const full_name = document.getElementById('signupName').value.trim();
        const username = document.getElementById('signupUsername').value.trim();
        const email = document.getElementById('signupEmail').value.trim();
        const password = signupPassword.value;

        clearErrors(signupForm);
        if (!full_name) return showFieldError('signupName', 'Name is required');
        if (!username || username.length < 3) return showFieldError('signupUsername', 'Username must be 3+ chars');
        if (!email) return showFieldError('signupEmail', 'Email is required');
        if (password.length < 6) return showFieldError('signupPassword', 'Password must be 6+ chars');

        btn.disabled = true;
        btn.innerHTML = '<div class="spinner"></div> Creating account...';

        try {
            const data = await apiFetch('/auth/register', {
                method: 'POST',
                body: JSON.stringify({ full_name, username, email, password })
            });
            setToken(data.token);
            setUser(data.user);
            showToast('Account created!', 'success');
            setTimeout(() => window.location.href = 'dashboard.html', 500);
        } catch (err) {
            showToast(err.message, 'error');
            btn.disabled = false;
            btn.innerHTML = 'Create Account';
        }
    });
});

function showFieldError(fieldId, msg) {
    const input = document.getElementById(fieldId);
    if (input) {
        input.classList.add('error');
        const errEl = input.closest('.form-group')?.querySelector('.form-error');
        if (errEl) { errEl.textContent = msg; errEl.classList.add('visible'); }
    }
}

function clearErrors(form) {
    form.querySelectorAll('.form-input').forEach(i => i.classList.remove('error'));
    form.querySelectorAll('.form-error').forEach(e => { e.textContent = ''; e.classList.remove('visible'); });
}
