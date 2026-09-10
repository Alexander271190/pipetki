const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'pipette.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// --- Схема ---
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  login TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  full_name TEXT NOT NULL,
  position TEXT NOT NULL,
  department TEXT,
  role TEXT DEFAULT 'user',
  extra_permissions TEXT DEFAULT '[]',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pipettes (
  id TEXT PRIMARY KEY,
  serial TEXT,
  manufacturer TEXT,
  model TEXT NOT NULL,
  volume TEXT,
  department TEXT,
  interval INTEGER DEFAULT 12,
  last_calibration TEXT,
  cert TEXT,
  last_result TEXT DEFAULT 'pass',
  active INTEGER DEFAULT 1,
  responsible TEXT,
  location TEXT,
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS calibration_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pipette_id TEXT NOT NULL,
  date TEXT NOT NULL,
  cert TEXT,
  result TEXT DEFAULT 'pass',
  org TEXT,
  note TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (pipette_id) REFERENCES pipettes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  user_full_name TEXT NOT NULL,
  action TEXT NOT NULL,
  details TEXT,
  timestamp TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS system_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

// --- Начальные данные ---
const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
if (userCount === 0) {
  const ins = db.prepare(`INSERT INTO users (id, login, password, full_name, position, department, role, extra_permissions)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  ins.run('admin1', 'admin', 'admin', 'Администратор', 'Главный метролог', null, 'admin', '[]');
  ins.run('senior1', 'senior', 'senior', 'Петров Петр', 'Старший лаборант', 'Гематологический отдел', 'senior_lab', '[]');
  ins.run('user1', 'user', 'user', 'Иванов Иван', 'Лаборант', 'Биохимический отдел', 'user', '[]');
}

const deptCount = db.prepare('SELECT COUNT(*) AS c FROM departments').get().c;
if (deptCount === 0) {
  const ins = db.prepare('INSERT INTO departments (name) VALUES (?)');
  ['Гематологический отдел','Биохимический отдел','Коагулогический отдел','Экспресс отдел',
   'Изосерологический отдел','Серологический отдел','ГИМИ','Бактериологический отдел'].forEach(d => ins.run(d));
}

const setCount = db.prepare('SELECT COUNT(*) AS c FROM system_settings').get().c;
if (setCount === 0) {
  db.prepare('INSERT INTO system_settings (setting_key, setting_value) VALUES (?, ?)').run('warn_days', '30');
}
// --- Демо-пипетки ---
const pipCount = db.prepare('SELECT COUNT(*) AS c FROM pipettes').get().c;
if (pipCount === 0) {
  const today = new Date();
  const ago = (m) => { const d = new Date(today); d.setMonth(d.getMonth() - m); return d.toISOString().slice(0, 10); };
  
  const ins = db.prepare(`INSERT INTO pipettes 
    (id, serial, manufacturer, model, volume, department, interval,
     last_calibration, cert, last_result, active, responsible, location, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  ins.run('П-001', 'EP2024001', 'Eppendorf', 'Research Plus', '1000', 'Гематологический отдел',
          12, ago(11), 'С-АБ-1234567/2025', 'pass', 1, 'Иванова М.С.', 'Лаб. 201, шкаф 3', '');
  ins.run('П-002', 'EP2024002', 'Eppendorf', 'Research Plus', '100', 'Биохимический отдел',
          12, ago(10), 'С-АБ-1234568/2025', 'pass', 1, 'Петров А.В.', 'Лаб. 201, шкаф 3', '');
  ins.run('П-003', 'GT2023005', 'Gilson', 'Pipetman L', '5000', 'Коагулогический отдел',
          6, ago(7), 'С-АБ-1234569/2025', 'pass', 1, 'Иванова М.С.', 'Лаб. 105', 'Требует внеочередной проверки');
  ins.run('П-004', 'BT2022003', 'Biohit', 'mLINE', '200', 'Экспресс отдел',
          12, ago(14), 'С-АБ-9876546/2024', 'pass', 1, 'Сидорова Е.К.', 'Лаб. 302', '');
  ins.run('П-005', 'TR2024008', 'Thermo', 'Finnpipette F2', '20', 'Серологический отдел',
          12, ago(2), 'С-АБ-1234570/2025', 'pass', 0, 'Петров А.В.', 'Склад', 'В резерве');
  
  // История поверок для П-001
  const insHist = db.prepare(`INSERT INTO calibration_history (pipette_id, date, cert, result, org, note)
                              VALUES (?, ?, ?, ?, ?, ?)`);
  insHist.run('П-001', ago(23), 'С-АБ-9876543/2024', 'pass', 'ФБУ «Красноярский ЦСМ»', 'Годна');
  insHist.run('П-001', ago(11), 'С-АБ-1234567/2025', 'pass', 'ФБУ «Красноярский ЦСМ»', 'Годна');
  insHist.run('П-003', ago(13), 'С-АБ-9876545/2024', 'fail', 'ФБУ «Красноярский ЦСМ»', 'Брак: превышение погрешности');
  insHist.run('П-003', ago(7), 'С-АБ-1234569/2025', 'pass', 'ФБУ «Красноярский ЦСМ»', 'После ремонта');
}
// --- Адаптер под mysql2/promise ---
function adapt(sql) {
  sql = sql.replace(
    /INSERT\s+INTO\s+system_settings\s*\([^)]+\)\s*VALUES\s*\([^)]+\)\s*ON\s+DUPLICATE\s+KEY\s+UPDATE\s+value\s*=\s*\?/gi,
    `INSERT INTO system_settings (setting_key, setting_value) VALUES (?, ?)
     ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value`
  );
  return sql;
}

async function query(sql, params = []) {
  sql = adapt(sql);
  const stmt = db.prepare(sql);
  const upper = sql.trim().toUpperCase();
  if (upper.startsWith('SELECT') || upper.startsWith('WITH')) {
    return [stmt.all(...params)];
  }
  const info = stmt.run(...params);
  return [{ insertId: info.lastInsertRowid, affectedRows: info.changes }];
}

async function getConnection() {
  return {
    query,
    beginTransaction: async () => db.exec('BEGIN'),
    commit: async () => db.exec('COMMIT'),
    rollback: async () => { try { db.exec('ROLLBACK'); } catch {} },
    release: () => {}
  };
}

module.exports = { query, getConnection, db };
