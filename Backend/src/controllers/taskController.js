const { dbRun, dbGet, dbAll } = require('../database');
const { body, validationResult } = require('express-validator');
const { broadcastToProject } = require('../websocket');

// Helper to get project ID for a task
async function getProjectIdForTask(taskId) {
    const row = await dbGet(`
        SELECT b.project_id FROM tasks t 
        JOIN boards b ON t.board_id = b.id 
        WHERE t.id = ?
    `, [taskId]);
    return row?.project_id;
}

// Helper to get project ID for a board
async function getProjectIdForBoard(boardId) {
    const row = await dbGet('SELECT project_id FROM boards WHERE id = ?', [boardId]);
    return row?.project_id;
}

const getTasks = async (req, res) => {
    try {
        const tasks = await dbAll(`
            SELECT t.*, u.username as assigned_username, u.avatar_color as assigned_avatar_color,
                   u.avatar_url as assigned_avatar_url,
                   u.full_name as assigned_full_name, c.username as creator_name,
                   (SELECT COUNT(*) FROM comments WHERE task_id = t.id) as comment_count
            FROM tasks t
            LEFT JOIN users u ON t.assigned_to = u.id
            JOIN users c ON t.created_by = c.id
            WHERE t.board_id = ? ORDER BY t.position ASC
        `, [req.params.boardId]);
        res.json({ tasks });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
};

const createTask = async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
        const { title, description, priority, assigned_to, due_date } = req.body;
        const boardId = req.params.boardId;
        const maxPos = await dbGet('SELECT MAX(position) as mp FROM tasks WHERE board_id = ?', [boardId]);
        const result = await dbRun(
            'INSERT INTO tasks (board_id, title, description, priority, assigned_to, due_date, position, created_by) VALUES (?,?,?,?,?,?,?,?)',
            [boardId, title, description || '', priority || 'medium', assigned_to || null, due_date || null, (maxPos?.mp || 0) + 1, req.user.id]
        );

        const projectId = await getProjectIdForBoard(boardId);
        
        if (assigned_to && assigned_to !== req.user.id) {
            await dbRun('INSERT INTO notifications (user_id, type, message, reference_id, reference_type) VALUES (?,?,?,?,?)',
                [assigned_to, 'task_assigned', `You were assigned to "${title}"`, result.id, 'task']);
        }

        const task = await dbGet(`
            SELECT t.*, u.username as assigned_username, u.avatar_color as assigned_avatar_color,
                   u.avatar_url as assigned_avatar_url,
                   u.full_name as assigned_full_name, c.username as creator_name
            FROM tasks t LEFT JOIN users u ON t.assigned_to = u.id
            JOIN users c ON t.created_by = c.id WHERE t.id = ?
        `, [result.id]);

        if (projectId) {
            broadcastToProject(projectId, { type: 'task:created', task }, req.user.id);
        }

        res.status(201).json({ message: 'Task created', task });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
};

const getTask = async (req, res) => {
    try {
        const task = await dbGet(`
            SELECT t.*, u.username as assigned_username, u.avatar_color as assigned_avatar_color,
                   u.avatar_url as assigned_avatar_url,
                   u.full_name as assigned_full_name, c.username as creator_name, c.avatar_color as creator_avatar_color,
                   c.avatar_url as creator_avatar_url
            FROM tasks t LEFT JOIN users u ON t.assigned_to = u.id
            JOIN users c ON t.created_by = c.id WHERE t.id = ?
        `, [req.params.id]);
        if (!task) return res.status(404).json({ error: 'Task not found' });
        res.json({ task });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
};

const updateTask = async (req, res) => {
    try {
        const task = await dbGet('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
        if (!task) return res.status(404).json({ error: 'Task not found' });
        const { title, description, priority, assigned_to, due_date } = req.body;
        
        const projectId = await getProjectIdForTask(task.id);

        await dbRun(
            'UPDATE tasks SET title=?, description=?, priority=?, assigned_to=?, due_date=?, updated_at=CURRENT_TIMESTAMP WHERE id=?',
            [title || task.title, description !== undefined ? description : task.description, priority || task.priority, assigned_to !== undefined ? assigned_to : task.assigned_to, due_date !== undefined ? due_date : task.due_date, task.id]
        );

        if (assigned_to && assigned_to !== task.assigned_to && assigned_to !== req.user.id) {
            await dbRun('INSERT INTO notifications (user_id, type, message, reference_id, reference_type) VALUES (?,?,?,?,?)',
                [assigned_to, 'task_assigned', `You were assigned to "${title || task.title}"`, task.id, 'task']);
        }

        const updated = await dbGet(`
            SELECT t.*, u.username as assigned_username, u.avatar_color as assigned_avatar_color,
                   u.avatar_url as assigned_avatar_url,
                   u.full_name as assigned_full_name, c.username as creator_name
            FROM tasks t LEFT JOIN users u ON t.assigned_to = u.id
            JOIN users c ON t.created_by = c.id WHERE t.id = ?
        `, [task.id]);

        if (projectId) {
            broadcastToProject(projectId, { type: 'task:updated', task: updated }, req.user.id);
        }

        res.json({ message: 'Task updated', task: updated });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
};

const moveTask = async (req, res) => {
    try {
        const { board_id, position } = req.body;
        const task = await dbGet('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
        if (!task) return res.status(404).json({ error: 'Task not found' });

        const projectId = await getProjectIdForTask(task.id);

        await dbRun('UPDATE tasks SET board_id=?, position=?, updated_at=CURRENT_TIMESTAMP WHERE id=?', [board_id, position || 0, task.id]);
        
        const updated = await dbGet(`
            SELECT t.*, u.username as assigned_username, u.avatar_color as assigned_avatar_color,
                   u.avatar_url as assigned_avatar_url,
                   u.full_name as assigned_full_name
            FROM tasks t LEFT JOIN users u ON t.assigned_to = u.id WHERE t.id = ?
        `, [task.id]);

        if (projectId) {
            broadcastToProject(projectId, { type: 'task:moved', task: updated }, req.user.id);
        }

        res.json({ message: 'Task moved', task: updated });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
};

const assignTask = async (req, res) => {
    try {
        const { user_id } = req.body;
        const task = await dbGet('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
        if (!task) return res.status(404).json({ error: 'Task not found' });
        
        const projectId = await getProjectIdForTask(task.id);

        await dbRun('UPDATE tasks SET assigned_to=?, updated_at=CURRENT_TIMESTAMP WHERE id=?', [user_id, task.id]);
        
        if (user_id && user_id !== req.user.id) {
            await dbRun('INSERT INTO notifications (user_id, type, message, reference_id, reference_type) VALUES (?,?,?,?,?)',
                [user_id, 'task_assigned', `You were assigned to "${task.title}"`, task.id, 'task']);
        }

        if (projectId) {
            broadcastToProject(projectId, { type: 'task:updated', taskId: task.id }, req.user.id);
        }

        res.json({ message: 'Task assigned' });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
};

const deleteTask = async (req, res) => {
    try {
        const task = await dbGet('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
        if (!task) return res.status(404).json({ error: 'Task not found' });

        const projectId = await getProjectIdForTask(task.id);

        await dbRun('DELETE FROM tasks WHERE id = ?', [task.id]);

        if (projectId) {
            broadcastToProject(projectId, { type: 'task:deleted', taskId: task.id }, req.user.id);
        }

        res.json({ message: 'Task deleted' });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
};

const createTaskValidation = [body('title').trim().isLength({ min: 1, max: 200 }).withMessage('Task title required')];

module.exports = { getTasks, createTask, getTask, updateTask, moveTask, assignTask, deleteTask, createTaskValidation };

