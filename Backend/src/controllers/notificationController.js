const { dbRun, dbAll } = require('../database');

const getNotifications = async (req, res) => {
    try {
        const notifications = await dbAll(
            'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
            [req.user.id]
        );
        const unreadCount = notifications.filter(n => !n.is_read).length;
        res.json({ notifications, unreadCount });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
};

const markAllRead = async (req, res) => {
    try {
        await dbRun('UPDATE notifications SET is_read = 1 WHERE user_id = ?', [req.user.id]);
        res.json({ message: 'All notifications marked as read' });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
};

const markRead = async (req, res) => {
    try {
        await dbRun('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
        res.json({ message: 'Notification marked as read' });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
};

module.exports = { getNotifications, markAllRead, markRead };
