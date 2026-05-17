const { dbRun, dbGet, dbAll } = require('../database');
const { body, validationResult } = require('express-validator');
const { broadcastToProject, sendToUser } = require('../websocket');

const getProjects = async (req, res) => {
    try {
        const projects = await dbAll(`
            SELECT p.*, u.username as owner_name, u.avatar_color as owner_avatar_color, u.avatar_url as owner_avatar_url,
                   (SELECT COUNT(*) FROM project_members WHERE project_id = p.id) as member_count,
                   (SELECT COUNT(*) FROM tasks t JOIN boards b ON t.board_id = b.id WHERE b.project_id = p.id) as task_count,
                   (SELECT COUNT(*) FROM tasks t JOIN boards b ON t.board_id = b.id WHERE b.project_id = p.id AND (b.name LIKE '%done%' OR b.name LIKE '%completed%')) as completed_task_count
            FROM projects p JOIN users u ON p.owner_id = u.id
            WHERE p.owner_id = ? OR p.id IN (SELECT project_id FROM project_members WHERE user_id = ?)
            ORDER BY p.created_at DESC
        `, [req.user.id, req.user.id]);
        
        const uniqueMembers = await dbGet(`
            SELECT COUNT(DISTINCT user_id) as count 
            FROM project_members 
            WHERE project_id IN (
                SELECT id FROM projects WHERE owner_id = ?
                UNION
                SELECT project_id FROM project_members WHERE user_id = ?
            )
        `, [req.user.id, req.user.id]);
        
        res.json({ projects, total_unique_members: uniqueMembers ? uniqueMembers.count : 1 });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
};

const createProject = async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
        const { name, description } = req.body;
        const colors = ['#7c3aed','#2563eb','#059669','#d97706','#dc2626','#0891b2','#4f46e5','#c026d3'];
        const color = colors[Math.floor(Math.random() * colors.length)];
        const result = await dbRun('INSERT INTO projects (name, description, owner_id, color) VALUES (?, ?, ?, ?)', [name, description || '', req.user.id, color]);
        await dbRun('INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)', [result.id, req.user.id, 'admin']);
        const defaultBoards = ['To Do', 'In Progress', 'Review', 'Done'];
        const boardColors = ['#6366f1', '#f59e0b', '#3b82f6', '#10b981'];
        for (let i = 0; i < defaultBoards.length; i++) {
            await dbRun('INSERT INTO boards (project_id, name, position, color) VALUES (?, ?, ?, ?)', [result.id, defaultBoards[i], i, boardColors[i]]);
        }
        const project = await dbGet('SELECT * FROM projects WHERE id = ?', [result.id]);
        res.status(201).json({ message: 'Project created', project });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
};

const getProject = async (req, res) => {
    try {
        const project = await dbGet(`SELECT p.*, u.username as owner_name, u.avatar_color as owner_avatar_color, u.avatar_url as owner_avatar_url FROM projects p JOIN users u ON p.owner_id = u.id WHERE p.id = ?`, [req.params.id]);
        if (!project) return res.status(404).json({ error: 'Project not found' });
        const isMember = await dbGet('SELECT id FROM project_members WHERE project_id = ? AND user_id = ?', [project.id, req.user.id]);
        if (!isMember && project.owner_id !== req.user.id) return res.status(403).json({ error: 'Access denied' });
        const members = await dbAll(`SELECT u.id, u.username, u.email, u.full_name, u.avatar_color, u.avatar_url, pm.role FROM project_members pm JOIN users u ON pm.user_id = u.id WHERE pm.project_id = ?`, [project.id]);
        res.json({ project, members });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
};

const updateProject = async (req, res) => {
    try {
        const { name, description } = req.body;
        const project = await dbGet('SELECT * FROM projects WHERE id = ?', [req.params.id]);
        if (!project) return res.status(404).json({ error: 'Project not found' });
        if (project.owner_id !== req.user.id) return res.status(403).json({ error: 'Only owner can update' });
        await dbRun('UPDATE projects SET name = ?, description = ? WHERE id = ?', [name || project.name, description !== undefined ? description : project.description, project.id]);
        const updated = await dbGet('SELECT * FROM projects WHERE id = ?', [project.id]);
        
        broadcastToProject(project.id, { type: 'project:updated', project: updated }, req.user.id);
        
        res.json({ message: 'Project updated', project: updated });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
};

const deleteProject = async (req, res) => {
    try {
        const project = await dbGet('SELECT * FROM projects WHERE id = ?', [req.params.id]);
        if (!project) return res.status(404).json({ error: 'Project not found' });
        if (project.owner_id !== req.user.id) return res.status(403).json({ error: 'Only owner can delete' });
        await dbRun('DELETE FROM projects WHERE id = ?', [project.id]);
        
        broadcastToProject(project.id, { type: 'project:deleted', projectId: project.id }, req.user.id);

        res.json({ message: 'Project deleted' });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
};

const addMember = async (req, res) => {
    try {
        const { user_id, role } = req.body;
        const project = await dbGet('SELECT * FROM projects WHERE id = ?', [req.params.id]);
        if (!project) return res.status(404).json({ error: 'Project not found' });
        const reqRole = await dbGet('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?', [project.id, req.user.id]);
        if (!reqRole || reqRole.role !== 'admin') return res.status(403).json({ error: 'Only admins can add members' });
        const user = await dbGet('SELECT id, username FROM users WHERE id = ?', [user_id]);
        if (!user) return res.status(404).json({ error: 'User not found' });
        const existing = await dbGet('SELECT id FROM project_members WHERE project_id = ? AND user_id = ?', [project.id, user_id]);
        if (existing) return res.status(409).json({ error: 'Already a member' });
        await dbRun('INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)', [project.id, user_id, role || 'member']);
        
        await dbRun('INSERT INTO notifications (user_id, type, message, reference_id, reference_type) VALUES (?, ?, ?, ?, ?)', [user_id, 'project_invite', `You were added to "${project.name}"`, project.id, 'project']);
        
        const member = await dbGet(`SELECT u.id, u.username, u.email, u.full_name, u.avatar_color, u.avatar_url, pm.role FROM project_members pm JOIN users u ON pm.user_id = u.id WHERE pm.project_id = ? AND pm.user_id = ?`, [project.id, user_id]);
        
        broadcastToProject(project.id, { type: 'member:joined', member }, req.user.id);
        sendToUser(user_id, { type: 'notification:new', message: `You were added to "${project.name}"` });

        res.status(201).json({ message: `${user.username} added` });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
};

const removeMember = async (req, res) => {
    try {
        const { user_id } = req.body;
        const project = await dbGet('SELECT * FROM projects WHERE id = ?', [req.params.id]);
        if (!project) return res.status(404).json({ error: 'Project not found' });
        if (project.owner_id === parseInt(user_id)) return res.status(400).json({ error: 'Cannot remove owner' });
        const reqRole = await dbGet('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?', [project.id, req.user.id]);
        if (!reqRole || reqRole.role !== 'admin') return res.status(403).json({ error: 'Only admins can remove' });
        await dbRun('DELETE FROM project_members WHERE project_id = ? AND user_id = ?', [project.id, user_id]);
        
        broadcastToProject(project.id, { type: 'member:left', userId: user_id }, req.user.id);

        res.json({ message: 'Member removed' });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
};

const getBoards = async (req, res) => {
    try {
        const boards = await dbAll('SELECT * FROM boards WHERE project_id = ? ORDER BY position ASC', [req.params.id]);
        res.json({ boards });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
};

const createBoard = async (req, res) => {
    try {
        const { name, color } = req.body;
        if (!name) return res.status(400).json({ error: 'Board name required' });
        const maxPos = await dbGet('SELECT MAX(position) as maxPos FROM boards WHERE project_id = ?', [req.params.id]);
        const result = await dbRun('INSERT INTO boards (project_id, name, position, color) VALUES (?, ?, ?, ?)', [req.params.id, name, (maxPos?.maxPos || 0) + 1, color || '#6366f1']);
        const board = await dbGet('SELECT * FROM boards WHERE id = ?', [result.id]);
        
        broadcastToProject(req.params.id, { type: 'board:created', board }, req.user.id);

        res.status(201).json({ message: 'Board created', board });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
};

const updateBoard = async (req, res) => {
    try {
        const { name, position, color } = req.body;
        const board = await dbGet('SELECT * FROM boards WHERE id = ?', [req.params.id]);
        if (!board) return res.status(404).json({ error: 'Board not found' });
        await dbRun('UPDATE boards SET name = ?, position = ?, color = ? WHERE id = ?', [name || board.name, position !== undefined ? position : board.position, color || board.color, board.id]);
        const updated = await dbGet('SELECT * FROM boards WHERE id = ?', [board.id]);
        
        broadcastToProject(board.project_id, { type: 'board:updated', board: updated }, req.user.id);

        res.json({ message: 'Board updated', board: updated });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
};

const deleteBoard = async (req, res) => {
    try {
        const board = await dbGet('SELECT * FROM boards WHERE id = ?', [req.params.id]);
        if (!board) return res.status(404).json({ error: 'Board not found' });
        await dbRun('DELETE FROM boards WHERE id = ?', [board.id]);
        
        broadcastToProject(board.project_id, { type: 'board:deleted', boardId: board.id }, req.user.id);

        res.json({ message: 'Board deleted' });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
};

const reorderBoards = async (req, res) => {
    try {
        const { boardIds } = req.body; // Array of board IDs in their new order
        if (!Array.isArray(boardIds)) return res.status(400).json({ error: 'boardIds must be an array' });

        const projectId = req.params.id;

        // Start transaction (or just run multiple queries)
        for (let i = 0; i < boardIds.length; i++) {
            await dbRun('UPDATE boards SET position = ? WHERE id = ? AND project_id = ?', [i, boardIds[i], projectId]);
        }

        broadcastToProject(projectId, { type: 'board:reordered' }, req.user.id);
        res.json({ message: 'Boards reordered' });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
};

const createProjectValidation = [body('name').trim().isLength({ min: 1, max: 100 }).withMessage('Project name required')];

module.exports = { getProjects, createProject, getProject, updateProject, deleteProject, addMember, removeMember, getBoards, createBoard, updateBoard, deleteBoard, reorderBoards, createProjectValidation };

