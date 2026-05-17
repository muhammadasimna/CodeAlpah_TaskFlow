const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { dbRun, dbGet } = require('../database');
require('dotenv').config();

// Random avatar colors
const AVATAR_COLORS = [
    '#7c3aed', '#2563eb', '#059669', '#d97706', '#dc2626',
    '#7c3aed', '#0891b2', '#4f46e5', '#c026d3', '#e11d48'
];

// Validation rules
const registerValidation = [
    body('username').trim().isLength({ min: 3, max: 30 }).withMessage('Username must be 3-30 characters'),
    body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('full_name').trim().isLength({ min: 1 }).withMessage('Full name is required')
];

const loginValidation = [
    body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
    body('password').notEmpty().withMessage('Password is required')
];

// Register
const register = async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { username, email, password, full_name } = req.body;

        // Check existing user
        const existingUser = await dbGet(
            'SELECT id FROM users WHERE email = ? OR username = ?',
            [email, username]
        );
        if (existingUser) {
            return res.status(409).json({ error: 'User with this email or username already exists' });
        }

        // Hash password
        const salt = await bcrypt.genSalt(12);
        const password_hash = await bcrypt.hash(password, salt);
        const avatar_color = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];

        const result = await dbRun(
            'INSERT INTO users (username, email, password_hash, full_name, avatar_color) VALUES (?, ?, ?, ?, ?)',
            [username, email, password_hash, full_name, avatar_color]
        );

        // Generate token
        const token = jwt.sign(
            { id: result.id, username, email },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN }
        );

        res.status(201).json({
            message: 'Registration successful',
            token,
            user: { id: result.id, username, email, full_name, avatar_color, avatar_url: null }
        });
    } catch (error) {
        console.error('Register error:', error);
        res.status(500).json({ error: 'Server error during registration' });
    }
};

// Login
const login = async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { email, password } = req.body;

        const user = await dbGet('SELECT * FROM users WHERE email = ?', [email]);
        if (!user) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        const token = jwt.sign(
            { id: user.id, username: user.username, email: user.email },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN }
        );

        res.json({
            message: 'Login successful',
            token,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                full_name: user.full_name,
                avatar_color: user.avatar_color,
                avatar_url: user.avatar_url
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Server error during login' });
    }
};

// Get current user profile
const getMe = async (req, res) => {
    try {
        const user = await dbGet(
            'SELECT id, username, email, full_name, avatar_color, avatar_url, created_at FROM users WHERE id = ?',
            [req.user.id]
        );
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json({ user });
    } catch (error) {
        console.error('GetMe error:', error);
        res.status(500).json({ error: 'Server error' });
    }
};

// Update profile
const updateProfile = async (req, res) => {
    try {
        const { full_name } = req.body;
        if (!full_name) return res.status(400).json({ error: 'Full name required' });

        await dbRun('UPDATE users SET full_name = ? WHERE id = ?', [full_name, req.user.id]);
        
        const user = await dbGet('SELECT id, username, email, full_name, avatar_color, avatar_url FROM users WHERE id = ?', [req.user.id]);
        res.json({ message: 'Profile updated', user });
    } catch (error) {
        console.error('Update profile error:', error);
        res.status(500).json({ error: 'Server error' });
    }
};

// Upload avatar
const uploadAvatar = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
        
        const avatar_url = `/uploads/avatars/${req.file.filename}`;
        await dbRun('UPDATE users SET avatar_url = ? WHERE id = ?', [avatar_url, req.user.id]);
        
        const user = await dbGet('SELECT id, username, email, full_name, avatar_color, avatar_url FROM users WHERE id = ?', [req.user.id]);
        res.json({ message: 'Avatar uploaded', user });
    } catch (error) {
        console.error('Upload avatar error:', error);
        res.status(500).json({ error: 'Server error during avatar upload: ' + error.message });
    }
};

// Remove avatar
const removeAvatar = async (req, res) => {
    try {
        await dbRun('UPDATE users SET avatar_url = NULL WHERE id = ?', [req.user.id]);
        const user = await dbGet('SELECT id, username, email, full_name, avatar_color, avatar_url FROM users WHERE id = ?', [req.user.id]);
        res.json({ message: 'Avatar removed', user });
    } catch (error) {
        console.error('Remove avatar error:', error);
        res.status(500).json({ error: 'Server error' });
    }
};

// Search users (for adding members)
const searchUsers = async (req, res) => {
    try {
        const { q } = req.query;
        if (!q || q.length < 2) {
            return res.json({ users: [] });
        }
        const users = await require('../database').dbAll(
            `SELECT id, username, email, full_name, avatar_color, avatar_url FROM users 
             WHERE (username LIKE ? OR email LIKE ? OR full_name LIKE ?) AND id != ?
             LIMIT 10`,
            [`%${q}%`, `%${q}%`, `%${q}%`, req.user.id]
        );
        res.json({ users });
    } catch (error) {
        console.error('Search users error:', error);
        res.status(500).json({ error: 'Server error' });
    }
};

module.exports = { 
    register, login, getMe, searchUsers, 
    updateProfile, uploadAvatar, removeAvatar,
    registerValidation, loginValidation 
};
