// Board page logic
let projectId = null;
let project = null;
let members = [];
let boards = [];
let tasksByBoard = {};

document.addEventListener('DOMContentLoaded', async () => {
    if (!requireAuth()) return;

    // Verify user still exists in database
    try {
        const data = await apiFetch('/auth/me');
        if (!data || !data.user) throw new Error('User not found');
        setUser(data.user); // Refresh local user data
    } catch (err) {
        removeToken();
        window.location.href = 'index.html';
        return;
    }

    const params = new URLSearchParams(window.location.search);
    projectId = params.get('project');
    if (!projectId) { window.location.href = 'dashboard.html'; return; }
    await loadProject();
    connectWebSocket();
    joinProject(parseInt(projectId));
    setupWsListeners();
    setupSidebar();
    setupEventListeners();
    setupBoardSearch();
    loadNotifications();
    setInterval(loadNotifications, 30000);
});

async function loadProject() {
    try {
        const data = await apiFetch(`/projects/${projectId}`);
        project = data.project;
        members = data.members || [];
        document.querySelector('.board-project-name').textContent = project.name;
        renderMembers();
        await loadBoards();
    } catch (err) {
        showToast('Failed to load project', 'error');
        setTimeout(() => window.location.href = 'dashboard.html', 1500);
    }
}

async function loadBoards() {
    try {
        const data = await apiFetch(`/projects/${projectId}/boards`);
        boards = data.boards || [];
        tasksByBoard = {};
        for (const board of boards) {
            const td = await apiFetch(`/tasks/boards/${board.id}/tasks`);
            tasksByBoard[board.id] = td.tasks || [];
        }
        renderKanban();
    } catch (err) {
        showToast('Failed to load boards', 'error');
    }
}

function renderMembers() {
    const container = document.querySelector('.board-members');
    if (!container) return;
    const user = getUser();
    container.innerHTML = members.slice(0, 5).map(m => `
        <div class="avatar-wrapper" title="${escapeHtml(m.full_name || m.username)}">
            ${createAvatar(m, null, 'avatar-sm')}
            ${project.owner_id === user?.id && m.id !== user?.id ? `
                <button class="member-remove-btn" onclick="event.stopPropagation(); removeMemberFromProject(${m.id})"><i class="fa-solid fa-xmark"></i></button>
            ` : ''}
        </div>
    `).join('');
    if (members.length > 5) {
        container.innerHTML += `<div class="avatar avatar-sm" style="background:#374151;font-size:0.6rem;margin-left:-8px;z-index:0;">+${members.length - 5}</div>`;
    }

    container.style.cursor = 'pointer';
    container.onclick = (e) => {
        if (!e.target.closest('.member-remove-btn')) {
            openProjectMembersModal();
        }
    };
}

function openProjectMembersModal() {
    const modal = document.getElementById('projectMembersModal');
    const list = document.getElementById('projectMembersList');
    if (!modal || !list) return;

    list.innerHTML = members.map(m => `
        <div class="member-dialog-item">
            ${createAvatar(m, null, 'avatar-md')}
            <div class="member-dialog-info">
                <span class="member-dialog-name">${escapeHtml(m.full_name || m.username)}</span>
                <span class="member-dialog-email">${escapeHtml(m.email)}</span>
            </div>
            <span class="member-dialog-role ${m.role}">${m.role}</span>
        </div>
    `).join('');

    modal.classList.add('active');
}

function closeProjectMembersModal() {
    document.getElementById('projectMembersModal')?.classList.remove('active');
}

async function removeMemberFromProject(userId) {
    if (!(await customConfirm('Remove this member from the project?', 'Remove Member', 'Remove'))) return;
    try {
        await apiFetch(`/projects/${projectId}/members`, {
            method: 'DELETE',
            body: JSON.stringify({ user_id: userId })
        });
        showToast('Member removed', 'success');
        await loadProject();
    } catch (err) { showToast(err.message, 'error'); }
}

function renderKanban() {
    const container = document.getElementById('kanbanContainer');
    if (!container) return;
    let html = '';
    boards.forEach(board => {
        const tasks = tasksByBoard[board.id] || [];
        html += `
        <div class="board-column" data-board-id="${board.id}" style="border-top-color: ${board.color || '#6366f1'}"
             draggable="true" ondragstart="handleBoardDragStart(event, ${board.id})" ondragend="handleBoardDragEnd(event)"
             ondragover="handleBoardDragOver(event)" ondrop="handleBoardDrop(event, ${board.id})">
            <div class="column-header">
                <div class="column-header-left">
                    <div class="column-color-dot" style="background:${board.color || '#6366f1'}"></div>
                    <input class="column-title" value="${escapeHtml(board.name)}" onblur="renameBoard(${board.id}, this.value)" onkeydown="if(event.key==='Enter')this.blur()">
                </div>
                <div class="column-header-right">
                    <span class="column-count">${tasks.length}</span>
                    <div class="column-actions">
                        <button class="column-action-btn delete" onclick="deleteBoard(${board.id})" title="Delete column"><i class="fa-solid fa-trash-can"></i></button>
                    </div>
                </div>
            </div>
            <div class="column-tasks" data-board-id="${board.id}"
                 ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)" ondrop="handleDrop(event, ${board.id})">
                ${tasks.length ? tasks.map(t => renderTaskCard(t)).join('') : `
                    <div style="text-align: center; padding: 20px; color: var(--text-muted); font-size: 0.85rem; border: 2px dashed var(--border-color); border-radius: var(--radius-md); margin-bottom: 10px;">
                        No tasks yet.<br>Drag one here or add below.
                    </div>
                `}
            </div>
            <div class="column-footer">
                <button class="add-task-btn" onclick="openAddTask(${board.id})"><i class="fa-solid fa-plus"></i> Add Task</button>
            </div>
        </div>`;
    });
    html += `
    <div class="add-column-wrapper">
        <div class="add-column-card" onclick="openAddColumn()">
            <div class="add-column-content">
                <span><i class="fa-solid fa-plus"></i></span>
                <p>Add Column</p>
            </div>
        </div>
    </div>`;
    container.innerHTML = html;
}

function openAddColumn() {
    document.getElementById('addColumnModal')?.classList.add('active');
    document.getElementById('columnNameInput')?.focus();
}

function closeAddColumnModal() {
    document.getElementById('addColumnModal')?.classList.remove('active');
}

async function submitAddColumn() {
    const name = document.getElementById('columnNameInput').value.trim();
    if (!name) return showToast('Column name is required', 'error');

    const colorOption = document.querySelector('#columnColorOptions .column-color-option.active');
    const color = colorOption ? colorOption.dataset.color : '#6366f1';

    try {
        await apiFetch(`/projects/${projectId}/boards`, {
            method: 'POST',
            body: JSON.stringify({ name, color })
        });
        showToast('Column added', 'success');
        closeAddColumnModal();
        await loadBoards();
    } catch (err) { showToast(err.message, 'error'); }
}

// Column color selection logic
document.getElementById('columnColorOptions')?.addEventListener('click', (e) => {
    if (e.target.classList.contains('column-color-option')) {
        document.querySelectorAll('#columnColorOptions .column-color-option').forEach(opt => opt.classList.remove('active'));
        e.target.classList.add('active');
    }
});

function setupBoardSearch() {
    document.getElementById('taskSearchInput')?.addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase().trim();
        document.querySelectorAll('.task-card').forEach(card => {
            const title = card.querySelector('.task-card-title')?.textContent.toLowerCase() || '';
            const desc = card.querySelector('.task-card-desc')?.textContent.toLowerCase() || '';
            if (title.includes(q) || desc.includes(q)) {
                card.style.display = 'block';
            } else {
                card.style.display = 'none';
            }
        });
    });
}

function renderTaskCard(t) {
    const dueStatus = getDueDateStatus(t.due_date);
    return `
    <div class="task-card" draggable="true" data-task-id="${t.id}"
         ondragstart="handleDragStart(event, ${t.id}, ${t.board_id})"
         ondragend="handleDragEnd(event)"
         onclick="openTaskDetail(${t.id})">
        <div class="task-card-header">
            <span class="task-card-title">${escapeHtml(t.title)}</span>
            <span class="badge badge-${t.priority}">${t.priority}</span>
        </div>
        ${t.description ? `<p class="task-card-desc">${escapeHtml(t.description)}</p>` : ''}
        <div class="task-card-footer">
            <div class="task-card-meta">
                ${t.assigned_username ? createAvatar({
                    full_name: t.assigned_full_name,
                    username: t.assigned_username,
                    avatar_color: t.assigned_avatar_color,
                    avatar_url: t.assigned_avatar_url
                }, null, 'avatar-sm') : ''}
                ${t.comment_count ? `<span class="task-card-meta-item"><i class="fa-solid fa-comments"></i> ${t.comment_count}</span>` : ''}
            </div>
            ${t.due_date ? `<span class="task-card-due ${dueStatus}">${formatDate(t.due_date)}</span>` : ''}
        </div>
    </div>`;
}

// Drag and Drop
let dragData = null;

function handleDragStart(e, taskId, boardId) {
    e.stopPropagation(); // Prevent board dragging
    dragData = { type: 'task', taskId, boardId };
    e.target.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
}

function handleDragEnd(e) {
    e.target.classList.remove('dragging');
    document.querySelectorAll('.column-tasks').forEach(c => c.classList.remove('drag-over'));
}

function handleDragOver(e) {
    if (!dragData || dragData.type !== 'task') return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    e.currentTarget.classList.add('drag-over');
}

function handleDragLeave(e) {
    e.currentTarget.classList.remove('drag-over');
}

async function handleDrop(e, targetBoardId) {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
    if (!dragData || dragData.type !== 'task') return;
    if (dragData.boardId === targetBoardId) return;
    try {
        await apiFetch(`/tasks/${dragData.taskId}/move`, {
            method: 'PUT',
            body: JSON.stringify({ board_id: targetBoardId, position: 0 })
        });
        await loadBoards();
        showToast('Task moved!', 'success');
    } catch (err) {
        showToast(err.message, 'error');
    }
    dragData = null;
}

// Board Column Drag and Drop
function handleBoardDragStart(e, boardId) {
    if (e.target.classList.contains('task-card')) return; // Ignore if dragging a task
    dragData = { type: 'board', boardId };
    e.target.style.opacity = '0.5';
    e.dataTransfer.effectAllowed = 'move';
}

function handleBoardDragEnd(e) {
    e.target.style.opacity = '1';
    document.querySelectorAll('.board-column').forEach(c => c.style.borderLeft = '');
}

function handleBoardDragOver(e) {
    if (!dragData || dragData.type !== 'board') return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const column = e.currentTarget;
    column.style.borderLeft = '4px solid var(--accent-primary)';
}

async function handleBoardDrop(e, targetBoardId) {
    e.preventDefault();
    document.querySelectorAll('.board-column').forEach(c => c.style.borderLeft = '');
    if (!dragData || dragData.type !== 'board') return;
    if (dragData.boardId === targetBoardId) return;
    
    // Find new order
    const draggedBoard = boards.find(b => b.id === dragData.boardId);
    let newBoards = boards.filter(b => b.id !== dragData.boardId);
    const targetIndex = newBoards.findIndex(b => b.id === targetBoardId);
    newBoards.splice(targetIndex, 0, draggedBoard);
    
    const boardIds = newBoards.map(b => b.id);
    
    // Optimistic UI update
    boards = newBoards;
    renderKanban();

    try {
        await apiFetch(`/projects/${projectId}/boards/reorder`, {
            method: 'PUT',
            body: JSON.stringify({ boardIds })
        });
    } catch (err) {
        showToast('Failed to reorder columns', 'error');
        await loadBoards(); // Revert
    }
    dragData = null;
}

// Add task
let addTaskBoardId = null;

function openAddTask(boardId) {
    addTaskBoardId = boardId;
    document.getElementById('addTaskModal')?.classList.add('active');
    document.getElementById('taskTitleInput')?.focus();
    populateAssigneeSelect();
}

function closeAddTaskModal() {
    document.getElementById('addTaskModal')?.classList.remove('active');
    document.getElementById('addTaskForm')?.reset();
}

function populateAssigneeSelect() {
    const sel = document.getElementById('taskAssignee');
    if (!sel) return;
    sel.innerHTML = '<option value="">Unassigned</option>' +
        members.map(m => `<option value="${m.id}">${escapeHtml(m.full_name || m.username)}</option>`).join('');
}

document.getElementById('addTaskForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = document.getElementById('taskTitleInput').value.trim();
    if (!title) return showToast('Title required', 'error');
    const body = {
        title,
        description: document.getElementById('taskDescInput').value.trim(),
        priority: document.getElementById('taskPriority').value,
        assigned_to: document.getElementById('taskAssignee').value || null,
        due_date: document.getElementById('taskDueDate').value || null
    };
    try {
        await apiFetch(`/tasks/boards/${addTaskBoardId}/tasks`, {
            method: 'POST', body: JSON.stringify(body)
        });
        showToast('Task created!', 'success');
        closeAddTaskModal();
        await loadBoards();
    } catch (err) { showToast(err.message, 'error'); }
});

// Task detail
async function openTaskDetail(taskId) {
    try {
        const data = await apiFetch(`/tasks/${taskId}`);
        const task = data.task;
        const modal = document.getElementById('taskDetailModal');
        document.getElementById('detailTaskId').value = task.id;
        document.getElementById('detailTitle').value = task.title;
        document.getElementById('detailDesc').value = task.description || '';
        document.getElementById('detailPriority').value = task.priority;
        document.getElementById('detailDueDate').value = task.due_date || '';
        const assignSel = document.getElementById('detailAssignee');
        assignSel.innerHTML = '<option value="">Unassigned</option>' +
            members.map(m => `<option value="${m.id}" ${m.id == task.assigned_to ? 'selected' : ''}>${escapeHtml(m.full_name || m.username)}</option>`).join('');
        modal?.classList.add('active');
        loadChecklists(taskId);
        loadComments(taskId);
    } catch (err) { showToast(err.message, 'error'); }
}

// Checklists
async function loadChecklists(taskId) {
    try {
        const data = await apiFetch(`/tasks/${taskId}/checklists`);
        const list = document.getElementById('checklistList');
        if (!list) return;

        const items = data.items || [];
        const completed = items.filter(i => i.is_completed).length;
        const total = items.length;
        const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

        document.getElementById('checklistProgressText').textContent = `${percent}%`;
        document.getElementById('checklistProgressBar').style.width = `${percent}%`;

        if (total === 0) {
            list.innerHTML = '';
        } else {
            list.innerHTML = items.map(i => `
                <div class="checklist-item" style="display: flex; align-items: center; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid var(--border-color);">
                    <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; flex: 1;">
                        <input type="checkbox" ${i.is_completed ? 'checked' : ''} onchange="toggleChecklistItem(${i.id}, this.checked)">
                        <span style="${i.is_completed ? 'text-decoration: line-through; color: var(--text-muted);' : 'color: var(--text-color);'}">${escapeHtml(i.content)}</span>
                    </label>
                    <button class="btn btn-ghost btn-sm" onclick="deleteChecklistItem(${i.id})" style="padding: 2px 6px; color: var(--text-muted);"><i class="fa-solid fa-xmark"></i></button>
                </div>
            `).join('');
        }
    } catch (err) { /* silent */ }
}

async function addChecklistItem() {
    const taskId = document.getElementById('detailTaskId').value;
    const input = document.getElementById('checklistInput');
    const content = input.value.trim();
    if (!content) return;
    try {
        await apiFetch(`/tasks/${taskId}/checklists`, {
            method: 'POST', body: JSON.stringify({ content })
        });
        input.value = '';
        loadChecklists(taskId);
    } catch (err) { showToast(err.message, 'error'); }
}

async function toggleChecklistItem(id, is_completed) {
    const taskId = document.getElementById('detailTaskId').value;
    try {
        await apiFetch(`/tasks/checklists/${id}`, {
            method: 'PUT', body: JSON.stringify({ is_completed: is_completed ? 1 : 0 })
        });
        loadChecklists(taskId);
    } catch (err) { showToast(err.message, 'error'); }
}

async function deleteChecklistItem(id) {
    const taskId = document.getElementById('detailTaskId').value;
    try {
        await apiFetch(`/tasks/checklists/${id}`, { method: 'DELETE' });
        loadChecklists(taskId);
    } catch (err) { showToast(err.message, 'error'); }
}

function closeTaskDetail() {
    document.getElementById('taskDetailModal')?.classList.remove('active');
}

document.getElementById('saveTaskBtn')?.addEventListener('click', async () => {
    const taskId = document.getElementById('detailTaskId').value;
    try {
        await apiFetch(`/tasks/${taskId}`, {
            method: 'PUT',
            body: JSON.stringify({
                title: document.getElementById('detailTitle').value.trim(),
                description: document.getElementById('detailDesc').value.trim(),
                priority: document.getElementById('detailPriority').value,
                assigned_to: document.getElementById('detailAssignee').value || null,
                due_date: document.getElementById('detailDueDate').value || null
            })
        });
        showToast('Task updated!', 'success');
        closeTaskDetail();
        await loadBoards();
    } catch (err) { showToast(err.message, 'error'); }
});

document.getElementById('deleteTaskBtn')?.addEventListener('click', async () => {
    const taskId = document.getElementById('detailTaskId').value;
    if (!(await customConfirm('Are you sure you want to delete this task?', 'Delete Task', 'Delete'))) return;
    try {
        await apiFetch(`/tasks/${taskId}`, { method: 'DELETE' });
        showToast('Task deleted', 'success');
        closeTaskDetail();
        await loadBoards();
    } catch (err) { showToast(err.message, 'error'); }
});

// Comments
async function loadComments(taskId) {
    try {
        const data = await apiFetch(`/comments/tasks/${taskId}/comments`);
        const list = document.getElementById('commentsList');
        const user = getUser();
        if (!list) return;
        if (!data.comments?.length) {
            list.innerHTML = '<p class="text-muted" style="font-size:0.85rem">No comments yet</p>';
        } else {
            list.innerHTML = data.comments.map(c => `
                <div class="comment-item">
                    ${createAvatar(c, null, 'avatar-sm')}
                    <div class="comment-body">
                        <div class="comment-header">
                            <span class="comment-author">${escapeHtml(c.full_name || c.username)}</span>
                            <span class="comment-time">${timeAgo(c.created_at)}</span>
                            ${c.user_id === user?.id ? `<button class="comment-delete" onclick="deleteComment(${c.id}, ${taskId})">Delete</button>` : ''}
                        </div>
                        <p class="comment-text">${escapeHtml(c.content)}</p>
                    </div>
                </div>
            `).join('');
        }
    } catch (err) { /* silent */ }
}

async function addComment() {
    const taskId = document.getElementById('detailTaskId').value;
    const input = document.getElementById('commentInput');
    const content = input.value.trim();
    if (!content) return;
    try {
        await apiFetch(`/comments/tasks/${taskId}/comments`, {
            method: 'POST', body: JSON.stringify({ content })
        });
        input.value = '';
        loadComments(taskId);
    } catch (err) { showToast(err.message, 'error'); }
}

async function deleteComment(commentId, taskId) {
    try {
        await apiFetch(`/comments/${commentId}`, { method: 'DELETE' });
        loadComments(taskId);
    } catch (err) { showToast(err.message, 'error'); }
}

// Board operations
async function renameBoard(boardId, name) {
    if (!name.trim()) return loadBoards();
    try {
        await apiFetch(`/tasks/boards/${boardId}`, {
            method: 'PUT', body: JSON.stringify({ name: name.trim() })
        });
    } catch (err) { showToast(err.message, 'error'); loadBoards(); }
}

async function deleteBoard(boardId) {
    if (!(await customConfirm('Are you sure you want to delete this column and all its tasks?', 'Delete Column', 'Delete'))) return;
    try {
        await apiFetch(`/tasks/boards/${boardId}`, { method: 'DELETE' });
        showToast('Column deleted', 'success');
        await loadBoards();
    } catch (err) { showToast(err.message, 'error'); }
}

// Member management modal functions are already defined below

// Add member
function openAddMemberModal() {
    document.getElementById('addMemberModal')?.classList.add('active');
    document.getElementById('memberSearchInput')?.focus();
}

function closeAddMemberModal() {
    document.getElementById('addMemberModal')?.classList.remove('active');
    const r = document.getElementById('memberSearchResults');
    if (r) r.innerHTML = '';
}

let searchTimeout;
document.getElementById('memberSearchInput')?.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(async () => {
        const q = e.target.value.trim();
        const results = document.getElementById('memberSearchResults');
        if (q.length < 2) { results.innerHTML = ''; return; }
        try {
            const data = await apiFetch(`/auth/search?q=${encodeURIComponent(q)}`);
            results.innerHTML = data.users.map(u => `
                <div class="notification-item" onclick="addMemberToProject(${u.id}, '${escapeHtml(u.username)}')">
                    ${createAvatar(u, null, 'avatar-sm')}
                    <div class="notification-item-content">
                        <div class="notification-item-text">${escapeHtml(u.full_name || u.username)}</div>
                        <div class="notification-item-time">@${escapeHtml(u.username)}</div>
                    </div>
                </div>
            `).join('') || '<div class="notification-empty">No users found</div>';
        } catch (err) { /* silent */ }
    }, 300);
});

async function addMemberToProject(userId, username) {
    try {
        await apiFetch(`/projects/${projectId}/members`, {
            method: 'POST', body: JSON.stringify({ user_id: userId })
        });
        showToast(`${username} added!`, 'success');
        closeAddMemberModal();
        await loadProject();
    } catch (err) { showToast(err.message, 'error'); }
}

function setupSidebar() {
    const user = getUser();
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

function setupEventListeners() {
    document.querySelector('.board-back-btn')?.addEventListener('click', () => {
        leaveProject();
        window.location.href = 'dashboard.html';
    });
    document.getElementById('commentInput')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addComment(); }
    });
    document.getElementById('checklistInput')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addChecklistItem(); }
    });
    document.getElementById('addColumnBtn')?.addEventListener('click', submitAddColumn);

    // Notification bell
    const notifBtn = document.getElementById('notifBtn');
    const notifDropdown = document.getElementById('notifDropdown');
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
}

function setupWsListeners() {
    wsOn('task:created', () => loadBoards());
    wsOn('task:moved', () => loadBoards());
    wsOn('task:updated', () => loadBoards());
    wsOn('comment:added', () => {
        const taskId = document.getElementById('detailTaskId')?.value;
        if (taskId) loadComments(taskId);
    });
    wsOn('notification:new', (data) => {
        showToast(data.message, 'info');
        loadNotifications();
    });
}

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
