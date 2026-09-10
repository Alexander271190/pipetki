const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret_key';

router.post('/login', async (req, res) => {
  const { login, password } = req.body;
  if (!login || !password) return res.status(400).json({ error: 'Заполните все поля' });
  try {
    const [users] = await db.query('SELECT * FROM users WHERE login = ?', [login]);
    if (!users.length || users[0].password !== password)
      return res.status(401).json({ error: 'Неверный логин или пароль' });

    const u = users[0];
    const token = jwt.sign({ id: u.id, login: u.login, role: u.role }, JWT_SECRET, { expiresIn: '24h' });

    await db.query('INSERT INTO audit_log (user_id, user_full_name, action) VALUES (?, ?, ?)',
      [u.id, u.full_name, 'Вход в систему']);

    res.json({
      token,
      user: {
        id: u.id, login: u.login, fullName: u.full_name, position: u.position,
        department: u.department, role: u.role,
        extraPermissions: JSON.parse(u.extra_permissions || '[]')
      }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.get('/verify', authenticate, (req, res) => {
  const u = req.user;
  res.json({
    user: {
      id: u.id, login: u.login, fullName: u.full_name, position: u.position,
      department: u.department, role: u.role,
      extraPermissions: JSON.parse(u.extra_permissions || '[]')
    }
  });
});

module.exports = router;
