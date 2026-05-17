const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const {
    getProjects, createProject, getProject, updateProject, deleteProject,
    addMember, removeMember, getBoards, createBoard, updateBoard, deleteBoard, reorderBoards,
    createProjectValidation
} = require('../controllers/projectController');

router.get('/', auth, getProjects);
router.post('/', auth, createProjectValidation, createProject);
router.get('/:id', auth, getProject);
router.put('/:id', auth, updateProject);
router.delete('/:id', auth, deleteProject);

// Members
router.post('/:id/members', auth, addMember);
router.delete('/:id/members', auth, removeMember);

// Boards
router.get('/:id/boards', auth, getBoards);
router.post('/:id/boards', auth, createBoard);
router.put('/:id/boards/reorder', auth, reorderBoards);

module.exports = router;
