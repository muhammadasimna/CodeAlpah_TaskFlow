const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
require('dotenv').config();

// Map of userId -> Set of WebSocket connections
const userConnections = new Map();
// Map of projectId -> Set of userIds currently viewing
const projectViewers = new Map();

function setupWebSocket(server) {
    const wss = new WebSocket.Server({ server, path: '/ws' });

    wss.on('connection', (ws, req) => {
        // Extract token from query
        const url = new URL(req.url, `http://${req.headers.host}`);
        const token = url.searchParams.get('token');

        if (!token) {
            ws.close(4001, 'Authentication required');
            return;
        }

        let user;
        try {
            user = jwt.verify(token, process.env.JWT_SECRET);
        } catch (err) {
            ws.close(4001, 'Invalid token');
            return;
        }

        ws.userId = user.id;
        ws.username = user.username;
        ws.isAlive = true;

        // Track connection
        if (!userConnections.has(user.id)) {
            userConnections.set(user.id, new Set());
        }
        userConnections.get(user.id).add(ws);

        console.log(`🔌 WebSocket: ${user.username} connected`);

        ws.on('pong', () => { ws.isAlive = true; });

        ws.on('message', (data) => {
            try {
                const msg = JSON.parse(data);
                handleMessage(ws, msg);
            } catch (e) {
                // Ignore invalid messages
            }
        });

        ws.on('close', () => {
            const conns = userConnections.get(user.id);
            if (conns) {
                conns.delete(ws);
                if (conns.size === 0) userConnections.delete(user.id);
            }
            // Remove from project viewers
            for (const [projId, viewers] of projectViewers) {
                viewers.delete(user.id);
                if (viewers.size === 0) projectViewers.delete(projId);
            }
            console.log(`🔌 WebSocket: ${user.username} disconnected`);
        });
    });

    // Heartbeat
    const interval = setInterval(() => {
        wss.clients.forEach((ws) => {
            if (!ws.isAlive) return ws.terminate();
            ws.isAlive = false;
            ws.ping();
        });
    }, 30000);

    wss.on('close', () => clearInterval(interval));

    return wss;
}

function handleMessage(ws, msg) {
    switch (msg.type) {
        case 'join_project':
            if (msg.projectId) {
                if (!projectViewers.has(msg.projectId)) {
                    projectViewers.set(msg.projectId, new Set());
                }
                projectViewers.get(msg.projectId).add(ws.userId);
                ws.currentProject = msg.projectId;
            }
            break;
        case 'leave_project':
            if (ws.currentProject) {
                const viewers = projectViewers.get(ws.currentProject);
                if (viewers) viewers.delete(ws.userId);
                ws.currentProject = null;
            }
            break;
    }
}

// Send event to specific user
function sendToUser(userId, event) {
    const conns = userConnections.get(userId);
    if (conns) {
        const data = JSON.stringify(event);
        conns.forEach(ws => {
            if (ws.readyState === WebSocket.OPEN) ws.send(data);
        });
    }
}

// Broadcast to all users viewing a project
function broadcastToProject(projectId, event, excludeUserId = null) {
    const viewers = projectViewers.get(projectId);
    if (viewers) {
        viewers.forEach(userId => {
            if (userId !== excludeUserId) {
                sendToUser(userId, event);
            }
        });
    }
}

module.exports = { setupWebSocket, sendToUser, broadcastToProject };
