const { dbRun, dbGet, dbAll } = require('../database');
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

const getComments = async (req, res) => {
    try {
        const comments = await dbAll(`
            SELECT c.*, u.username, u.full_name, u.avatar_color, u.avatar_url
            FROM comments c JOIN users u ON c.user_id = u.id
            WHERE c.task_id = ? ORDER BY c.created_at ASC
        `, [req.params.taskId]);
        res.json({ comments });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
};

const addComment = async (req, res) => {
    try {
        const { content } = req.body;
        if (!content || !content.trim()) return res.status(400).json({ error: 'Comment content required' });
        const task = await dbGet('SELECT * FROM tasks WHERE id = ?', [req.params.taskId]);
        if (!task) return res.status(404).json({ error: 'Task not found' });
        
        const projectId = await getProjectIdForTask(task.id);

        const result = await dbRun(
            'INSERT INTO comments (task_id, user_id, content) VALUES (?,?,?)',
            [req.params.taskId, req.user.id, content.trim()]
        );
        // Notify task assignee and creator
        const notifyUsers = new Set();
        if (task.assigned_to && task.assigned_to !== req.user.id) notifyUsers.add(task.assigned_to);
        if (task.created_by !== req.user.id) notifyUsers.add(task.created_by);
        for (const uid of notifyUsers) {
            await dbRun('INSERT INTO notifications (user_id, type, message, reference_id, reference_type) VALUES (?,?,?,?,?)',
                [uid, 'new_comment', `New comment on "${task.title}"`, task.id, 'task']);
        }
        
        const comment = await dbGet(`
            SELECT c.*, u.username, u.full_name, u.avatar_color, u.avatar_url
            FROM comments c JOIN users u ON c.user_id = u.id WHERE c.id = ?
        `, [result.id]);

        if (projectId) {
            broadcastToProject(projectId, { type: 'comment:added', comment, taskId: task.id }, req.user.id);
        }

        res.status(201).json({ message: 'Comment added', comment });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
};

const deleteComment = async (req, res) => {
    try {
        const comment = await dbGet('SELECT * FROM comments WHERE id = ?', [req.params.id]);
        if (!comment) return res.status(404).json({ error: 'Comment not found' });
        if (comment.user_id !== req.user.id) return res.status(403).json({ error: 'Can only delete own comments' });
        
        const projectId = await getProjectIdForTask(comment.task_id);

        await dbRun('DELETE FROM comments WHERE id = ?', [comment.id]);

        if (projectId) {
            broadcastToProject(projectId, { type: 'comment:deleted', commentId: comment.id, taskId: comment.task_id }, req.user.id);
        }

        res.json({ message: 'Comment deleted' });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
};

module.exports = { getComments, addComment, deleteComment };

