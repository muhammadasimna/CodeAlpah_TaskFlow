const { dbRun, dbAll, dbGet } = require('../database');
const { broadcastToProject } = require('../websocket');

async function getProjectIdForTask(taskId) {
    const row = await dbGet(`
        SELECT b.project_id FROM tasks t 
        JOIN boards b ON t.board_id = b.id 
        WHERE t.id = ?
    `, [taskId]);
    return row?.project_id;
}

const getChecklist = async (req, res) => {
    try {
        const items = await dbAll('SELECT * FROM checklists WHERE task_id = ? ORDER BY position ASC', [req.params.taskId]);
        res.json({ items });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
};

const addChecklistItem = async (req, res) => {
    try {
        const { content } = req.body;
        const taskId = req.params.taskId;
        if (!content) return res.status(400).json({ error: 'Content required' });

        const maxPos = await dbGet('SELECT MAX(position) as mp FROM checklists WHERE task_id = ?', [taskId]);
        const result = await dbRun(
            'INSERT INTO checklists (task_id, content, position) VALUES (?, ?, ?)',
            [taskId, content, (maxPos?.mp || 0) + 1]
        );

        const item = await dbGet('SELECT * FROM checklists WHERE id = ?', [result.id]);
        const projectId = await getProjectIdForTask(taskId);
        if (projectId) {
            broadcastToProject(projectId, { type: 'checklist:added', taskId, item }, req.user.id);
        }

        res.status(201).json({ item });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
};

const updateChecklistItem = async (req, res) => {
    try {
        const { content, is_completed, position } = req.body;
        const item = await dbGet('SELECT * FROM checklists WHERE id = ?', [req.params.id]);
        if (!item) return res.status(404).json({ error: 'Item not found' });

        await dbRun(
            'UPDATE checklists SET content = ?, is_completed = ?, position = ? WHERE id = ?',
            [
                content !== undefined ? content : item.content,
                is_completed !== undefined ? is_completed : item.is_completed,
                position !== undefined ? position : item.position,
                req.params.id
            ]
        );

        const updated = await dbGet('SELECT * FROM checklists WHERE id = ?', [req.params.id]);
        const projectId = await getProjectIdForTask(item.task_id);
        if (projectId) {
            broadcastToProject(projectId, { type: 'checklist:updated', taskId: item.task_id, item: updated }, req.user.id);
        }

        res.json({ item: updated });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
};

const deleteChecklistItem = async (req, res) => {
    try {
        const item = await dbGet('SELECT * FROM checklists WHERE id = ?', [req.params.id]);
        if (!item) return res.status(404).json({ error: 'Item not found' });

        await dbRun('DELETE FROM checklists WHERE id = ?', [req.params.id]);
        const projectId = await getProjectIdForTask(item.task_id);
        if (projectId) {
            broadcastToProject(projectId, { type: 'checklist:deleted', taskId: item.task_id, itemId: item.id }, req.user.id);
        }

        res.json({ message: 'Item deleted' });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
};

module.exports = { getChecklist, addChecklistItem, updateChecklistItem, deleteChecklistItem };
