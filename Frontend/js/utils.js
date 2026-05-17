// Utility functions
function getToken() { return localStorage.getItem('pm_token'); }
function setToken(token) { localStorage.setItem('pm_token', token); }
function removeToken() { localStorage.removeItem('pm_token'); localStorage.removeItem('pm_user'); }
function getUser() { try { return JSON.parse(localStorage.getItem('pm_user')); } catch { return null; } }
function setUser(user) { localStorage.setItem('pm_user', JSON.stringify(user)); }

// Theme management
function initTheme() {
    const theme = localStorage.getItem('pm_theme') || 'dark';
    if (theme === 'light') {
        document.documentElement.classList.add('light-mode');
    } else {
        document.documentElement.classList.remove('light-mode');
    }
    updateThemeToggleIcon();
}

function toggleTheme() {
    const isLight = document.documentElement.classList.toggle('light-mode');
    localStorage.setItem('pm_theme', isLight ? 'light' : 'dark');
    updateThemeToggleIcon();
}

function updateThemeToggleIcon() {
    const themeToggle = document.getElementById('themeToggle');
    if (!themeToggle) return;
    const isLight = document.documentElement.classList.contains('light-mode');
    themeToggle.innerHTML = isLight ? '<i class="fa-solid fa-moon"></i>' : '<i class="fa-solid fa-sun"></i>';
}

// Initialize theme and accent color immediately
initTheme();
initAccentColor();

// Accent Color management
function initAccentColor() {
    const color = localStorage.getItem('pm_accent_color') || '#7c3aed';
    const secondary = localStorage.getItem('pm_accent_secondary') || '#a855f7';
    applyAccentColor(color, secondary);
}

function setAccentColor(color, secondary) {
    localStorage.setItem('pm_accent_color', color);
    localStorage.setItem('pm_accent_secondary', secondary);
    applyAccentColor(color, secondary);
}

function applyAccentColor(color, secondary) {
    document.documentElement.style.setProperty('--accent-primary', color);
    document.documentElement.style.setProperty('--accent-secondary', secondary);
    document.documentElement.style.setProperty('--accent-gradient', `linear-gradient(135deg, ${color}, ${secondary}, ${color}dd)`);
    document.documentElement.style.setProperty('--accent-glow', `0 0 20px ${color}4d`);
    document.documentElement.style.setProperty('--border-accent', `${color}4d`);
}

// Set up theme toggle listener when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    const themeToggle = document.getElementById('themeToggle');
    if (themeToggle) {
        themeToggle.addEventListener('click', toggleTheme);
    }
    updateThemeToggleIcon();
    setupColorPalette();
    setupProfile();

    // Sidebar active state management
    const sidebarLinks = document.querySelectorAll('.sidebar-link');
    sidebarLinks.forEach(link => {
        link.addEventListener('click', function() {
            // Remove active class from all links
            sidebarLinks.forEach(l => l.classList.remove('active'));
            // Add active class to the clicked one
            this.classList.add('active');
        });
    });
});

function setupProfile() {
    const sidebarUser = document.querySelector('.sidebar-user');
    const modal = document.getElementById('profileModal');
    const form = document.getElementById('profileForm');
    const avatarInput = document.getElementById('avatarInput');
    const removeBtn = document.getElementById('removeAvatarBtn');

    if (!sidebarUser || !modal) return;

    sidebarUser.addEventListener('click', () => {
        const user = getUser();
        if (!user) return;

        document.getElementById('profileEmailDisplay').value = user.email;
        document.getElementById('profileNameInput').value = user.full_name || '';
        document.getElementById('profileAvatarPreview').innerHTML = createAvatar(user, null, 'profile-avatar-preview');
        
        removeBtn.style.display = user.avatar_url ? 'block' : 'none';
        modal.classList.add('active');
    });

    form?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const full_name = document.getElementById('profileNameInput').value.trim();
        const btn = form.querySelector('button[type="submit"]');
        const originalText = btn.innerHTML;

        try {
            btn.disabled = true;
            btn.innerHTML = '<div class="spinner"></div> Saving...';
            const data = await apiFetch('/auth/profile', {
                method: 'PUT',
                body: JSON.stringify({ full_name })
            });
            setUser(data.user);
            showToast('Profile updated!', 'success');
            closeProfileModal();
            // Refresh UI components that use user info
            if (typeof setupSidebar === 'function') setupSidebar();
        } catch (err) {
            showToast(err.message, 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    });

    avatarInput?.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const formData = new FormData();
        formData.append('avatar', file);

        try {
            showToast('Uploading avatar...', 'info');
            const res = await fetch(`${API_BASE}/auth/profile/avatar`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${getToken()}` },
                body: formData
            });
            
            const contentType = res.headers.get('content-type');
            let data;
            if (contentType && contentType.includes('application/json')) {
                data = await res.json();
            } else {
                if (res.status === 404) throw new Error('Upload endpoint not found (404). Please restart the backend server.');
                throw new Error(`Server error (${res.status})`);
            }

            if (!res.ok) throw new Error(data.error || 'Upload failed');

            setUser(data.user);
            document.getElementById('profileAvatarPreview').innerHTML = createAvatar(data.user, null, 'profile-avatar-preview');
            removeBtn.style.display = 'block';
            showToast('Avatar updated!', 'success');
            if (typeof setupSidebar === 'function') setupSidebar();
        } catch (err) {
            showToast(err.message, 'error');
        }
    });

    removeBtn?.addEventListener('click', async () => {
        if (!(await customConfirm('Are you sure you want to remove your profile picture?', 'Remove Picture', 'Remove'))) return;
        try {
            const data = await apiFetch('/auth/profile/avatar', { method: 'DELETE' });
            setUser(data.user);
            document.getElementById('profileAvatarPreview').innerHTML = createAvatar(data.user, null, 'profile-avatar-preview');
            removeBtn.style.display = 'none';
            showToast('Avatar removed', 'success');
            if (typeof setupSidebar === 'function') setupSidebar();
        } catch (err) {
            showToast(err.message, 'error');
        }
    });
}

function closeProfileModal() {
    document.getElementById('profileModal')?.classList.remove('active');
}

function setupColorPalette() {
    const paletteBtn = document.getElementById('colorPaletteBtn');
    const modal = document.getElementById('colorPaletteModal');
    const options = document.querySelectorAll('.color-option');

    paletteBtn?.addEventListener('click', () => {
        modal?.classList.add('active');
        // Highlight active color
        const currentColor = localStorage.getItem('pm_accent_color') || '#7c3aed';
        options.forEach(opt => {
            if (opt.dataset.primary === currentColor) opt.classList.add('active');
            else opt.classList.remove('active');
        });
        // Set custom picker value
        const customPicker = document.getElementById('customColorInput');
        if (customPicker) {
            customPicker.value = currentColor;
            const valueSpan = document.getElementById('customColorValue');
            if (valueSpan) valueSpan.textContent = currentColor;
        }
    });

    options.forEach(opt => {
        opt.addEventListener('click', () => {
            const primary = opt.dataset.primary;
            const secondary = opt.dataset.secondary;
            setAccentColor(primary, secondary);
            options.forEach(o => o.classList.remove('active'));
            opt.classList.add('active');
            showToast('Theme color updated!', 'success');
        });
    });

    // Custom color picker logic
    const customPicker = document.getElementById('customColorInput');
    customPicker?.addEventListener('input', (e) => {
        const primary = e.target.value;
        const secondary = adjustColor(primary, 30); // Lighten for gradient
        setAccentColor(primary, secondary);
        const valueSpan = document.getElementById('customColorValue');
        if (valueSpan) valueSpan.textContent = primary;
        // Remove active class from presets
        options.forEach(o => o.classList.remove('active'));
    });
}

function adjustColor(col, amt) {
    col = col.replace(/^#/, '');
    if (col.length === 3) col = col[0] + col[0] + col[1] + col[1] + col[2] + col[2];
    let [r, g, b] = col.match(/.{2}/g).map(x => parseInt(x, 16));
    r = Math.max(0, Math.min(255, r + amt));
    g = Math.max(0, Math.min(255, g + amt));
    b = Math.max(0, Math.min(255, b + amt));
    const rr = (r.toString(16).length === 1 ? '0' + r.toString(16) : r.toString(16));
    const gg = (g.toString(16).length === 1 ? '0' + g.toString(16) : g.toString(16));
    const bb = (b.toString(16).length === 1 ? '0' + b.toString(16) : b.toString(16));
    return '#' + rr + gg + bb;
}

function closeColorPaletteModal() {
    document.getElementById('colorPaletteModal')?.classList.remove('active');
}

function isLoggedIn() {
    const token = getToken();
    if (!token) return false;
    try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        return payload.exp * 1000 > Date.now();
    } catch { return false; }
}

// Auth-gated redirect
function requireAuth() {
    if (!isLoggedIn()) { window.location.href = 'index.html'; return false; }
    return true;
}

function redirectIfLoggedIn() {
    if (isLoggedIn()) { window.location.href = 'dashboard.html'; return true; }
    return false;
}

// Fetch wrapper
async function apiFetch(endpoint, options = {}) {
    const token = getToken();
    const config = {
        headers: { 'Content-Type': 'application/json', ...options.headers },
        ...options
    };
    if (token) config.headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${API_BASE}${endpoint}`, config);
    
    // Check if response is JSON
    const contentType = res.headers.get('content-type');
    let data;
    if (contentType && contentType.includes('application/json')) {
        data = await res.json();
    } else {
        const text = await res.text();
        if (res.status === 404) throw new Error('API endpoint not found (404). Please restart the backend server.');
        throw new Error(`Server error (${res.status}): ${text.substring(0, 50)}...`);
    }

    if (res.status === 401) { 
        removeToken(); 
        if (!window.location.pathname.endsWith('index.html')) window.location.href = 'index.html'; 
        return null; 
    }
    if (!res.ok) throw new Error(data?.error || data?.errors?.[0]?.msg || 'Something went wrong');
    return data;
}

// Toast notifications
function showToast(message, type = 'info') {
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    const icons = { 
        success: '<i class="fa-solid fa-circle-check"></i>', 
        error: '<i class="fa-solid fa-circle-xmark"></i>', 
        info: '<i class="fa-solid fa-circle-info"></i>', 
        warning: '<i class="fa-solid fa-triangle-exclamation"></i>' 
    };
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
        <span class="toast-icon">${icons[type] || icons.info}</span>
        <span class="toast-message">${message}</span>
    `;
    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('removing');
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// Avatar helper
function createAvatar(userOrName, color, size = '') {
    // If first arg is a user object
    if (typeof userOrName === 'object' && userOrName !== null) {
        const user = userOrName;
        if (user.avatar_url) {
            return `<div class="avatar ${size} avatar-img"><img src="${IMAGE_BASE}${user.avatar_url}" alt="${escapeHtml(user.full_name || user.username)}"></div>`;
        }
        const name = user.full_name || user.username;
        const initials = (name || '?').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
        return `<div class="avatar ${size}" style="background:${user.avatar_color || '#7c3aed'}">${initials}</div>`;
    }

    // Legacy support (name, color strings)
    const name = userOrName;
    const initials = (name || '?').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
    return `<div class="avatar ${size}" style="background:${color || '#7c3aed'}">${initials}</div>`;
}

// Helper to ensure SQLite dates are parsed as UTC
function parseDateAsUTC(dateStr) {
    if (!dateStr) return new Date();
    if (typeof dateStr === 'string' && !dateStr.includes('T') && !dateStr.includes('Z')) {
        // SQLite usually returns 'YYYY-MM-DD HH:MM:SS' which is in UTC.
        // Convert to ISO 8601 UTC string.
        dateStr = dateStr.replace(' ', 'T') + 'Z';
    }
    return new Date(dateStr);
}

// Time ago
function timeAgo(dateStr) {
    if (!dateStr) return '';
    const now = new Date();
    const date = parseDateAsUTC(dateStr);
    const secs = Math.floor((now - date) / 1000);
    if (secs < 60) return 'just now';
    if (secs < 3600) return Math.floor(secs / 60) + 'm ago';
    if (secs < 86400) return Math.floor(secs / 3600) + 'h ago';
    if (secs < 604800) return Math.floor(secs / 86400) + 'd ago';
    return date.toLocaleDateString();
}

// Format date
function formatDate(dateStr) {
    if (!dateStr) return '';
    return parseDateAsUTC(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Due date status
function getDueDateStatus(dateStr) {
    if (!dateStr) return '';
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const due = parseDateAsUTC(dateStr); due.setHours(0, 0, 0, 0);
    const diff = (due - now) / (1000 * 60 * 60 * 24);
    if (diff < 0) return 'overdue';
    if (diff <= 2) return 'soon';
    return '';
}

// Escape HTML
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// Custom Confirm Dialog
function customConfirm(message, title = 'Confirm Action', confirmText = 'Confirm', cancelText = 'Cancel') {
    return new Promise((resolve) => {
        let overlay = document.getElementById('customConfirmModal');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.className = 'modal-overlay';
            overlay.id = 'customConfirmModal';
            overlay.innerHTML = `
                <div class="modal modal-sm" style="max-width: 400px; padding: 24px;">
                    <div class="modal-header" style="margin-bottom: 16px;">
                        <h3 id="customConfirmTitle" style="font-size: 1.25rem; font-weight: 600;">Confirm Action</h3>
                        <button class="modal-close" id="customConfirmCloseBtn"><i class="fa-solid fa-xmark"></i></button>
                    </div>
                    <div class="modal-body">
                        <p id="customConfirmMessage" style="margin-bottom: 24px; color: var(--text-secondary); line-height: 1.5;"></p>
                    </div>
                    <div class="modal-footer" style="padding: 0; border: none; justify-content: flex-end; gap: 12px;">
                        <button class="btn btn-ghost" id="customConfirmCancelBtn">Cancel</button>
                        <button class="btn btn-primary" id="customConfirmOkBtn">Confirm</button>
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);
        }

        document.getElementById('customConfirmTitle').textContent = title;
        document.getElementById('customConfirmMessage').textContent = message;
        document.getElementById('customConfirmCancelBtn').textContent = cancelText;
        document.getElementById('customConfirmOkBtn').textContent = confirmText;

        const okBtn = document.getElementById('customConfirmOkBtn');
        if (confirmText.toLowerCase().includes('delete') || confirmText.toLowerCase().includes('remove')) {
            okBtn.style.background = 'var(--danger-color, #ef4444)';
            okBtn.style.color = 'white';
        } else {
            okBtn.style.background = '';
            okBtn.style.color = '';
        }

        const cleanupAndResolve = (result) => {
            overlay.classList.remove('active');
            
            // Remove event listeners by cloning nodes
            const newOkBtn = okBtn.cloneNode(true);
            okBtn.parentNode.replaceChild(newOkBtn, okBtn);
            
            const cancelBtn = document.getElementById('customConfirmCancelBtn');
            const newCancelBtn = cancelBtn.cloneNode(true);
            cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
            
            const closeBtn = document.getElementById('customConfirmCloseBtn');
            const newCloseBtn = closeBtn.cloneNode(true);
            closeBtn.parentNode.replaceChild(newCloseBtn, closeBtn);
            
            resolve(result);
        };

        document.getElementById('customConfirmOkBtn').addEventListener('click', () => cleanupAndResolve(true));
        document.getElementById('customConfirmCancelBtn').addEventListener('click', () => cleanupAndResolve(false));
        document.getElementById('customConfirmCloseBtn').addEventListener('click', () => cleanupAndResolve(false));

        overlay.classList.add('active');
    });
}
