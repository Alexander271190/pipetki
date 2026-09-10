const express = require('express');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

// Отделы
router.get('/departments', authenticate, async (req, res) => {
  const [rows] = await db.query('SELECT name FROM departments ORDER BY name');
  res.json(rows.map(r => r.name));
});

router.put('/departments', authenticate, requireRole(['admin']), async (req, res) => {
  const departments = req.body;
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM departments');
    for (const name of departments) {
      await conn.query('INSERT INTO departments (name) VALUES (?)', [name]);
    }
    await conn.commit();
    res.json({ message: 'Отделы обновлены' });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: 'Ошибка обновления отделов' });
  } finally {
    conn.release();
  }
});

// Системные настройки
router.get('/system', authenticate, async (req, res) => {
  const [rows] = await db.query('SELECT setting_key, setting_value FROM system_settings');
  const result = {};
  for (const s of rows) result[s.setting_key] = s.setting_value;
  res.json(result);
});

router.put('/system', authenticate, requireRole(['admin']), async (req, res) => {
  const settings = req.body;
  try {
    for (const [k, v] of Object.entries(settings)) {
      await db.query(
        `INSERT INTO system_settings (setting_key, setting_value) VALUES (?, ?)
         ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value`,
        [k, String(v)]
      );
    }
    res.json({ message: 'Настройки обновлены' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка обновления настроек' });
  }
});

module.exports = router;
