const express = require('express');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

// ============================================================
// ОТДЕЛЫ
// ============================================================
router.get('/departments', authenticate, async (req, res) => {
  const [rows] = await db.query('SELECT name FROM departments ORDER BY name');
  res.json(rows.map(r => r.name));
});

router.put('/departments', authenticate, requireRole(['admin']), async (req, res) => {
  const departments = req.body;
  if (!Array.isArray(departments)) return res.status(400).json({ error: 'Ожидается массив' });
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM departments');
    for (const name of departments) {
      if (name && name.trim()) {
        await conn.query('INSERT INTO departments (name) VALUES (?)', [name.trim()]);
      }
    }
    await conn.commit();
    res.json({ message: 'Отделы обновлены' });
  } catch (e) {
    await conn.rollback();
    console.error(e);
    res.status(500).json({ error: 'Ошибка обновления отделов' });
  } finally {
    conn.release();
  }
});

// ============================================================
// ПОЛЯ ФОРМЫ
// ============================================================
router.get('/fields', authenticate, async (req, res) => {
  const [rows] = await db.query('SELECT * FROM field_config ORDER BY field_order');
  res.json(rows.map(f => ({
    id: f.id,
    label: f.label,
    type: f.type,
    required: !!f.required,
    enabled: !!f.enabled,
    options: JSON.parse(f.options || '[]'),
    default: f.default_value || '',
    order: f.field_order
  })));
});

router.put('/fields', authenticate, requireRole(['admin']), async (req, res) => {
  const fields = req.body;
  if (!Array.isArray(fields)) return res.status(400).json({ error: 'Ожидается массив' });

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    // Полная синхронизация: удаляем все поля и вставляем заново
    await conn.query('DELETE FROM field_config');
    for (const f of fields) {
      await conn.query(
        `INSERT INTO field_config (id, label, type, required, enabled, options, default_value, field_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [f.id, f.label, f.type, f.required ? 1 : 0, f.enabled !== false ? 1 : 0,
         JSON.stringify(f.options || []), f.default || '', f.order || 0]
      );
    }
    await conn.commit();
    res.json({ message: 'Поля обновлены' });
  } catch (e) {
    await conn.rollback();
    console.error(e);
    res.status(500).json({ error: 'Ошибка обновления полей' });
  } finally {
    conn.release();
  }
});

// ============================================================
// НАСТРОЙКИ ЭКСПОРТА
// ============================================================
router.get('/export', authenticate, async (req, res) => {
  const [rows] = await db.query('SELECT fields FROM export_settings WHERE id = 1');
  if (!rows.length) return res.json([]);
  res.json(JSON.parse(rows[0].fields));
});

router.put('/export', authenticate, requireRole(['admin']), async (req, res) => {
  const fields = req.body;
  if (!Array.isArray(fields)) return res.status(400).json({ error: 'Ожидается массив' });
  await db.query(
    `INSERT INTO export_settings (id, fields) VALUES (1, ?)
     ON CONFLICT(id) DO UPDATE SET fields = excluded.fields`,
    [JSON.stringify(fields)]
  );
  res.json({ message: 'Настройки экспорта обновлены' });
});

// ============================================================
// СИСТЕМНЫЕ НАСТРОЙКИ
// ============================================================
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
