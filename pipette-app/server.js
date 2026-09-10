const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*', credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Раздача статики (index.html, style.css, script.js)
app.use(express.static(path.join(__dirname, 'frontend')));

// API
app.use('/api/auth', require('./routes/auth'));
app.use('/api/pipettes', require('./routes/pipettes'));
app.use('/api/users', require('./routes/users'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/log', require('./routes/log'));
app.use('/api/backup', require('./routes/backup'));

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// Всё остальное — отдаём index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Server on http://0.0.0.0:${PORT}`);
  console.log(`👤 admin/admin, senior/senior, user/user`);
});
