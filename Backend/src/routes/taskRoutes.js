const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { getTasks, createTask, getTask, updateTask, moveTask, assignTask, deleteTask, createTaskValidation } = require('../controllers/taskController');
const { updateBoard, deleteBoard } = require('../controllers/projectController');

const { getChecklist, addChecklistItem, updateChecklistItem, deleteChecklistItem } = require('../controllers/checklistController');

// Board operations
router.put('/boards/:id', auth, updateBoard);
router.delete('/boards/:id', auth, deleteBoard);

// Task CRUD
router.get('/boards/:boardId/tasks', auth, getTasks);
router.post('/boards/:boardId/tasks', auth, createTaskValidation, createTask);
router.get('/:id', auth, getTask);
router.put('/:id', auth, updateTask);
router.put('/:id/move', auth, moveTask);
router.put('/:id/assign', auth, assignTask);
router.delete('/:id', auth, deleteTask);

// Checklist CRUD
router.get('/:taskId/checklists', auth, getChecklist);
router.post('/:taskId/checklists', auth, addChecklistItem);
router.put('/checklists/:id', auth, updateChecklistItem);
router.delete('/checklists/:id', auth, deleteChecklistItem);

module.exports = router;
