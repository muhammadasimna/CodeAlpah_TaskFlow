// WebSocket client
let ws = null;
let wsReconnectTimer = null;
const wsListeners = {};

function connectWebSocket() {
    const token = getToken();
    if (!token || ws?.readyState === WebSocket.OPEN) return;

    ws = new WebSocket(`${WS_BASE}?token=${token}`);

    ws.onopen = () => {
        console.log('🔌 WebSocket connected');
        if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }
    };

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.type && wsListeners[data.type]) {
                wsListeners[data.type].forEach(cb => cb(data));
            }
        } catch (e) { /* ignore */ }
    };

    ws.onclose = () => {
        console.log('🔌 WebSocket disconnected');
        if (isLoggedIn()) {
            wsReconnectTimer = setTimeout(connectWebSocket, 3000);
        }
    };

    ws.onerror = () => { ws.close(); };
}

function wsSend(data) {
    if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
    }
}

function wsOn(type, callback) {
    if (!wsListeners[type]) wsListeners[type] = [];
    wsListeners[type].push(callback);
}

function wsOff(type) { delete wsListeners[type]; }

function joinProject(projectId) { wsSend({ type: 'join_project', projectId }); }
function leaveProject() { wsSend({ type: 'leave_project' }); }

function disconnectWebSocket() {
    if (wsReconnectTimer) clearTimeout(wsReconnectTimer);
    if (ws) ws.close();
    ws = null;
}
