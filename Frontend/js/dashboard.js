// Dashboard page logic
let currentUser = null;
let projects = [];

document.addEventListener('DOMContentLoaded', async () => {
    if (!requireAuth()) return;
    
    // Verify user still exists in database
    try {
        const data = await apiFetch('/auth/me');
        if (!data || !data.user) throw new Error('User not found');
        setUser(data.user); // Refresh local user data
        currentUser = data.user;
    } catch (err) {
        removeToken();
        window.location.href = 'index.html';
        return;
    }

    setupSidebar();
    setupTopbar();
    await loadDashboard();
    connectWebSocket();
    setupWsListeners();
    loadNotifications();
});

function setupSidebar() {
    currentUser = getUser();
    const user = currentUser;
    if (!user) return;
    const nameEl = document.querySelector('.sidebar-user-name');
    const emailEl = document.querySelector('.sidebar-user-email');
    const userSection = document.querySelector('.sidebar-user');
    
    if (nameEl) nameEl.textContent = user.full_name || user.username;
    if (emailEl) emailEl.textContent = user.email;
    if (userSection) {
        const oldAvatar = userSection.querySelector('.avatar');
        if (oldAvatar) oldAvatar.outerHTML = createAvatar(user);
    }

    // Mobile sidebar toggle
    const hamburger = document.querySelector('.topbar-hamburger');
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.querySelector('.sidebar-overlay');
    hamburger?.addEventListener('click', () => {
        sidebar?.classList.toggle('open');
        overlay?.classList.toggle('open');
    });
    overlay?.addEventListener('click', () => {
        sidebar?.classList.remove('open');
        overlay?.classList.remove('open');
    });

    // Logout
    document.getElementById('logoutBtn')?.addEventListener('click', async () => {
        if (!(await customConfirm('Are you sure you want to log out?', 'Log Out', 'Log Out'))) return;
        removeToken();
        disconnectWebSocket();
        window.location.href = 'index.html';
    });
}

function setupTopbar() {
    const user = currentUser;
    const welcomeEl = document.querySelector('.dashboard-welcome h1');
    if (welcomeEl) {
        const hour = new Date().getHours();
        const greeting = hour < 12 ? 'Good Morning' : hour < 17 ? 'Good Afternoon' : 'Good Evening';
        welcomeEl.textContent = `${greeting}, ${user?.full_name?.split(' ')[0] || user?.username || 'there'}! 👋`;
    }

    // Notification bell
    const notifBtn = document.querySelector('.notification-btn');
    const notifDropdown = document.querySelector('.notification-dropdown');
    notifBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        notifDropdown?.classList.toggle('open');
    });
    document.addEventListener('click', () => notifDropdown?.classList.remove('open'));
    notifDropdown?.addEventListener('click', (e) => e.stopPropagation());

    // Mark all read
    document.getElementById('markAllRead')?.addEventListener('click', async () => {
        try {
            await apiFetch('/notifications/read', { method: 'PUT' });
            loadNotifications();
        } catch (err) { showToast(err.message, 'error'); }
    });

    // Search functionality
    const searchInput = document.getElementById('searchInput');
    searchInput?.addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase().trim();
        const filtered = projects.filter(p => 
            p.name.toLowerCase().includes(q) || 
            (p.description && p.description.toLowerCase().includes(q))
        );
        renderProjects(filtered);
    });
}

async function loadDashboard() {
    try {
        const data = await apiFetch('/projects');
        projects = data.projects || [];
        const totalUniqueMembers = data.total_unique_members || 1;
        renderStats(totalUniqueMembers);
        renderProjects();
    } catch (err) {
        showToast('Failed to load projects', 'error');
    }
}

function renderStats(totalMembers = 1) {
    const totalProjects = projects.length;
    const totalTasks = projects.reduce((sum, p) => sum + (p.task_count || 0), 0);

    document.getElementById('statProjects') && (document.getElementById('statProjects').textContent = totalProjects);
    document.getElementById('statTasks') && (document.getElementById('statTasks').textContent = totalTasks);
    document.getElementById('statMembers') && (document.getElementById('statMembers').textContent = totalMembers);
}

function renderProjects(projectsToRender = projects) {
    const grid = document.getElementById('projectsGrid');
    if (!grid) return;

    let html = '';
    projectsToRender.forEach(p => {
        const total = p.task_count || 0;
        const completed = p.completed_task_count || 0;
        const progressPercent = total > 0 ? Math.round((completed / total) * 100) : 0;
        
        html += `
        <div class="project-card" onclick="openProject(${p.id})">
            <div class="project-card-accent" style="background:${p.color || '#7c3aed'}"></div>
            <div class="project-card-options" onclick="event.stopPropagation()">
                <button class="project-option-btn" onclick="event.stopPropagation(); openEditProjectModal(${p.id})"><i class="fa-solid fa-pen"></i></button>
                <button class="project-option-btn delete" onclick="event.stopPropagation(); deleteProject(${p.id})"><i class="fa-solid fa-trash-can"></i></button>
            </div>
            <div class="project-card-body">
                <h3 class="project-card-title">${escapeHtml(p.name)}</h3>
                <p class="project-card-desc">${escapeHtml(p.description || 'No description')}</p>
                
                <div class="project-progress-container" style="margin-top: 15px; margin-bottom: 15px;">
                    <div style="display: flex; justify-content: space-between; font-size: 0.75rem; color: var(--text-muted); margin-bottom: 5px;">
                        <span>Progress</span>
                        <span>${progressPercent}%</span>
                    </div>
                    <div style="width: 100%; height: 6px; background: var(--bg-primary); border-radius: 3px; overflow: hidden;">
                        <div style="width: ${progressPercent}%; height: 100%; background: ${p.color || 'var(--primary)'}; transition: width 0.3s ease;"></div>
                    </div>
                </div>

                <div class="project-card-meta">
                    <div class="project-card-members">
                        ${createAvatar({
                            full_name: p.owner_name,
                            avatar_color: p.owner_avatar_color,
                            avatar_url: p.owner_avatar_url
                        }, null, 'avatar-sm')}
                    </div>
                    <div class="project-card-stats">
                        <span class="project-card-stat"><i class="fa-solid fa-users"></i> ${p.member_count || 1}</span>
                        <span class="project-card-stat"><i class="fa-solid fa-check-double"></i> ${completed}/${total}</span>
                    </div>
                </div>
            </div>
        </div>`;
    });

    if (projectsToRender.length === 0 && projects.length > 0) {
        html = `
        <div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-muted); background: var(--card-bg); border-radius: var(--radius-lg); border: 1px dashed var(--border-color);">
            <i class="fa-solid fa-magnifying-glass" style="font-size: 2rem; margin-bottom: 16px; display: block; color: var(--primary);"></i>
            <h3 style="margin-bottom: 8px; color: var(--text-color);">No matches found</h3>
            <p>We couldn't find any projects matching your search.</p>
        </div>
        `;
    } else if (projects.length === 0) {
         html = `
        <div style="grid-column: 1/-1; text-align: center; padding: 60px 40px; background: var(--card-bg); border-radius: var(--radius-lg); border: 2px dashed var(--border-color); display: flex; flex-direction: column; align-items: center; justify-content: center;">
            <div style="width: 64px; height: 64px; border-radius: 50%; background: rgba(124, 58, 237, 0.1); display: flex; align-items: center; justify-content: center; margin-bottom: 20px;">
                <i class="fa-solid fa-rocket" style="font-size: 2rem; color: var(--primary);"></i>
            </div>
            <h3 style="margin-bottom: 10px; color: var(--text-color); font-size: 1.25rem;">Create Your First Project</h3>
            <p style="color: var(--text-muted); max-width: 400px; margin-bottom: 24px;">Start organizing your tasks, inviting team members, and boosting your productivity.</p>
            <button class="btn btn-primary" onclick="openCreateModal()"><i class="fa-solid fa-plus"></i> New Project</button>
        </div>
        `;
    }

    html += `
    <div class="create-project-card" onclick="openCreateModal()">
        <div class="create-project-icon"><i class="fa-solid fa-plus"></i></div>
        <span>Create New Project</span>
    </div>`;

    grid.innerHTML = html;
}

async function deleteProject(id) {
    if (!(await customConfirm('Are you sure you want to delete this project? This will remove all tasks and boards.', 'Delete Project', 'Delete'))) return;
    try {
        await apiFetch(`/projects/${id}`, { method: 'DELETE' });
        showToast('Project deleted', 'success');
        await loadDashboard();
    } catch (err) { showToast(err.message, 'error'); }
}

let editProjectId = null;
function openEditProjectModal(id) {
    const p = projects.find(p => p.id === id);
    if (!p) return;
    editProjectId = id;
    document.getElementById('editProjectNameInput').value = p.name;
    document.getElementById('editProjectDescInput').value = p.description || '';
    document.getElementById('editProjectModal').classList.add('active');
}

function closeEditProjectModal() {
    document.getElementById('editProjectModal').classList.remove('active');
}

document.getElementById('editProjectForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!editProjectId) return;
    const name = document.getElementById('editProjectNameInput').value.trim();
    const description = document.getElementById('editProjectDescInput').value.trim();
    if (!name) return showToast('Project name is required', 'error');

    const btn = e.target.querySelector('button[type="submit"]');
    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<div class="spinner"></div> Saving...';

    try {
        await apiFetch(`/projects/${editProjectId}`, {
            method: 'PUT',
            body: JSON.stringify({ name, description })
        });
        showToast('Project updated', 'success');
        closeEditProjectModal();
        await loadDashboard();
    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
});

function openProject(id) {
    window.location.href = `board.html?project=${id}`;
}

function openCreateModal() {
    document.getElementById('createProjectModal')?.classList.add('active');
    document.getElementById('projectNameInput')?.focus();
}

function closeCreateModal() {
    document.getElementById('createProjectModal')?.classList.remove('active');
    document.getElementById('createProjectForm')?.reset();
}

document.getElementById('createProjectForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('projectNameInput').value.trim();
    const description = document.getElementById('projectDescInput').value.trim();
    if (!name) return showToast('Project name is required', 'error');

    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.innerHTML = '<div class="spinner"></div> Creating...';

    try {
        await apiFetch('/projects', {
            method: 'POST',
            body: JSON.stringify({ name, description })
        });
        showToast('Project created!', 'success');
        closeCreateModal();
        await loadDashboard();
    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = 'Create Project';
    }
});

async function loadNotifications() {
    try {
        const data = await apiFetch('/notifications');
        const badge = document.querySelector('.notification-badge');
        const list = document.getElementById('notificationList');
        if (badge) {
            badge.textContent = data.unreadCount || 0;
            badge.style.display = data.unreadCount > 0 ? 'flex' : 'none';
        }
        if (list) {
            if (!data.notifications?.length) {
                list.innerHTML = '<div class="notification-empty">No notifications yet <i class="fa-solid fa-bell"></i></div>';
            } else {
                list.innerHTML = data.notifications.map(n => `
                    <div class="notification-item ${n.is_read ? '' : 'unread'}" onclick="markAsRead(${n.id})">
                        <div class="notification-item-dot"></div>
                        <div class="notification-item-content">
                            <div class="notification-item-text">${escapeHtml(n.message)}</div>
                            <div class="notification-item-time">${timeAgo(n.created_at)}</div>
                        </div>
                    </div>
                `).join('');
            }
        }
    } catch (err) { /* silent */ }
}

async function markAsRead(id) {
    try {
        await apiFetch(`/notifications/${id}/read`, { method: 'PUT' });
        loadNotifications();
    } catch (err) { /* silent */ }
}

// Poll notifications every 30s
setInterval(loadNotifications, 30000);

function setupWsListeners() {
    wsOn('notification:new', (data) => {
        showToast(data.message, 'info');
        loadNotifications();
    });
    wsOn('project:updated', () => loadDashboard());
    wsOn('project:deleted', () => loadDashboard());
}
