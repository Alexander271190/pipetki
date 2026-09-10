const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

const BACKUP_DIR = path.join(__dirname, '..', 'data', 'backups');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

// Список бэкапов
router.get('/', authenticate, requireRole(['admin']), (req, res) => {
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('pipette_') && f.endsWith('.db'))
      .map(f => {
        const stat = fs.statSync(path.join(BACKUP_DIR, f));
        return { name: f, size: stat.size, created: stat.mtime };
      })
      .sort((a, b) => new Date(b.created) - new Date(a.created));
    res.json(files);
  } catch (e) {
    res.json([]);
  }
});

// Создать бэкап
router.post('/', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `pipette_${timestamp}.db`;
    const dest = path.join(BACKUP_DIR, filename);
    const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'pipette.db');

    // SQLite VACUUM INTO — безопасный способ бэкапа
    db.db.prepare(`VACUUM INTO ?`).run(dest);

    // Чистим старые — оставляем последние 10
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('pipette_') && f.endsWith('.db'))
      .sort()
      .reverse();
    if (files.length > 10) {
      files.slice(10).forEach(f => {
        try { fs.unlinkSync(path.join(BACKUP_DIR, f)); } catch {}
      });
    }

    res.json({ message: 'Бэкап создан', filename });
  } catch (e) {
    console.error('Backup error:', e);
    res.status(500).json({ error: 'Ошибка создания бэкапа: ' + e.message });
  }
});

// Восстановить из бэкапа
router.post('/restore/:filename', authenticate, requireRole(['admin']), async (req, res) => {
  const src = path.join(BACKUP_DIR, req.params.filename);
  if (!fs.existsSync(src)) return res.status(404).json({ error: 'Бэкап не найден' });

  // Простое решение: копируем файл поверх текущей БД, затем перезапускаем сервер
  // Для простоты — просим пользователя перезапустить контейнер
  try {
    const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'pipette.db');
    fs.copyFileSync(src, DB_PATH);
    res.json({ message: 'Бэкап восстановлен. Перезапустите приложение.', restartRequired: true });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка восстановления: ' + e.message });
  }
});

// Удалить бэкап
router.delete('/:filename', authenticate, requireRole(['admin']), (req, res) => {
  const file = path.join(BACKUP_DIR, req.params.filename);
  if (fs.existsSync(file)) {
    fs.unlinkSync(file);
    res.json({ message: 'Бэкап удалён' });
  } else {
    res.status(404).json({ error: 'Бэкап не найден' });
  }
});

// Скачать бэкап
router.get('/download/:filename', authenticate, requireRole(['admin']), (req, res) => {
  const file = path.join(BACKUP_DIR, req.params.filename);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Не найден' });
  res.download(file);
});

// Сбросить все данные (пипетки, история, лог)
router.post('/reset', authenticate, requireRole(['admin']), async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM calibration_history');
    await conn.query('DELETE FROM pipettes');
    await conn.query('DELETE FROM audit_log');
    await conn.commit();
    res.json({ message: 'Все данные удалены' });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: 'Ошибка сброса' });
  } finally {
    conn.release();
  }
});

module.exports = router;
