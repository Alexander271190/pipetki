// ============================================================
// КОНФИГУРАЦИЯ API
// ============================================================
const API_URL = '/api';
let authToken = null;
let currentUser = null;

// ============================================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ============================================================
function esc(s) { return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function formatDate(d) { if (!d) return '—'; return new Date(d).toLocaleDateString('ru-RU', {day:'2-digit',month:'2-digit',year:'numeric'}); }

function showToast(msg, type) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show ' + (type || '');
  clearTimeout(t._timeout);
  t._timeout = setTimeout(() => t.className = 'toast', 4000);
}

// ============================================================
// API КЛИЕНТ
// ============================================================
async function apiRequest(endpoint, method = 'GET', data = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

  const options = { method, headers };
  if (data) options.body = JSON.stringify(data);

  const response = await fetch(`${API_URL}${endpoint}`, options);

  if (response.status === 401) {
    clearSession();
    renderAuthUI();
    showToast('Сессия истекла, войдите заново', 'error');
    throw new Error('Неавторизован');
  }

  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Ошибка запроса');
  return result;
}

// ============================================================
// АВТОРИЗАЦИЯ
// ============================================================
function getSession() {
  try {
    const data = JSON.parse(sessionStorage.getItem('pipette_session'));
    if (data && data.token) {
      authToken = data.token;
      currentUser = data.user;
      return data;
    }
  } catch {}
  return null;
}

function setSession(user, token) {
  const data = { user, token };
  sessionStorage.setItem('pipette_session', JSON.stringify(data));
  authToken = token;
  currentUser = user;
}

function clearSession() {
  sessionStorage.removeItem('pipette_session');
  authToken = null;
  currentUser = null;
}

function isAuthenticated() { return !!currentUser; }
function isAdmin() { return currentUser && currentUser.role === 'admin'; }
function isSeniorLab() { return currentUser && currentUser.role === 'senior_lab'; }
function canManagePipettes() { return isAdmin() || isSeniorLab(); }

async function loginUser(e) {
  e.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value.trim();
  const errorEl = document.getElementById('login-error');
  errorEl.textContent = '';

  if (!username || !password) {
    errorEl.textContent = 'Заполните все поля';
    return;
  }

  try {
    const result = await apiRequest('/auth/login', 'POST', { login: username, password });
    setSession(result.user, result.token);
    showToast(`Добро пожаловать, ${result.user.fullName}!`, 'success');
    renderAuthUI();
    await loadPipetteData();
  } catch (error) {
    errorEl.textContent = error.message || 'Ошибка входа';
  }
}

function logoutUser() {
  clearSession();
  renderAuthUI();
  showToast('Вы вышли из системы', 'success');
}

// ============================================================
// ЗАГРУЗКА ДАННЫХ
// ============================================================
let pipettes = [];
let settings = { warnDays: 30 };
let sortField = 'nextCalibration';
let sortDir = 1;
let currentHistoryId = null;

async function loadPipetteData() {
  if (!isAuthenticated()) return;
  try {
    const data = await apiRequest('/pipettes');
    pipettes = data;
    const settingsData = await apiRequest('/settings/system');
    settings = { warnDays: parseInt(settingsData.warn_days) || 30 };
    await loadDepartments();
    render();
    checkReminder();
  } catch (error) {
    console.error('Error loading data:', error);
    showToast('Ошибка загрузки данных', 'error');
  }
}

async function loadDepartments() {
  try {
    const depts = await apiRequest('/settings/departments');
    const filterSelect = document.getElementById('filter-department');
    if (filterSelect) {
      const currentVal = filterSelect.value;
      filterSelect.innerHTML = '<option value="">Все</option>' +
        depts.map(d => `<option value="${esc(d)}">${esc(d)}</option>`).join('');
      if (depts.includes(currentVal)) filterSelect.value = currentVal;
    }
  } catch (error) {
    console.error('Error loading departments:', error);
  }
}

// ============================================================
// СТАТУСЫ ПИПЕТОК
// ============================================================
function calcStatus(p) {
  if (!p.active) return 'inactive';
  if (!p.last_calibration || !p.interval) return 'danger';
  const last = new Date(p.last_calibration);
  const next = new Date(last);
  next.setMonth(next.getMonth() + p.interval);
  const now = new Date(); now.setHours(0,0,0,0);
  const daysLeft = Math.ceil((next - now) / 86400000);
  if (daysLeft < 0) return 'danger';
  if (daysLeft <= settings.warnDays) return 'warn';
  return 'ok';
}

function getNextDate(p) {
  if (!p.last_calibration || !p.interval) return null;
  const d = new Date(p.last_calibration);
  d.setMonth(d.getMonth() + p.interval);
  return d;
}

function daysLeft(p) {
  const next = getNextDate(p);
  if (!next) return -9999;
  const now = new Date(); now.setHours(0,0,0,0);
  return Math.ceil((next - now) / 86400000);
}

// ============================================================
// РЕНДЕР
// ============================================================
function render() {
  let filtered = getFilteredPipettes();

  filtered.sort((a, b) => {
    let va, vb;
    if (sortField === 'nextCalibration') {
      va = getNextDate(a) || new Date(8640000000000000);
      vb = getNextDate(b) || new Date(8640000000000000);
    } else if (sortField === 'volume') {
      va = parseFloat(a.volume) || 0;
      vb = parseFloat(b.volume) || 0;
    } else {
      va = (a[sortField] || '').toString().toLowerCase();
      vb = (b[sortField] || '').toString().toLowerCase();
    }
    if (va < vb) return -1 * sortDir;
    if (va > vb) return 1 * sortDir;
    return 0;
  });

  let ok = 0, warn = 0, danger = 0;
  pipettes.forEach(p => {
    const s = calcStatus(p);
    if (s === 'ok') ok++;
    else if (s === 'warn') warn++;
    else if (s === 'danger') danger++;
  });
  document.getElementById('stat-ok').textContent = ok;
  document.getElementById('stat-warn').textContent = warn;
  document.getElementById('stat-danger').textContent = danger;
  document.getElementById('stat-total').textContent = pipettes.length;

  const banner = document.getElementById('alert-banner');
  if (danger > 0) {
    document.getElementById('alert-text').textContent = `У ${danger} ${danger === 1 ? 'пипетки просрочена' : 'пипеток просрочена'} поверка! Требуется срочное действие.`;
    banner.classList.add('show');
  } else if (warn > 0) {
    document.getElementById('alert-text').textContent = `У ${warn} ${warn === 1 ? 'пипетки подходит' : 'пипеток подходят'} к сроку поверки в течение ${settings.warnDays} дн.`;
    banner.classList.add('show');
  } else {
    banner.classList.remove('show');
  }

  const tbody = document.getElementById('pipettes-body');
  const empty = document.getElementById('empty-state');
  const table = document.getElementById('pipettes-table');

  if (filtered.length === 0) {
    tbody.innerHTML = '';
    table.style.display = 'none';
    empty.style.display = 'block';
    if (pipettes.length > 0) empty.querySelector('p').textContent = 'Ничего не найдено по фильтру.';
    return;
  }
  table.style.display = '';
  empty.style.display = 'none';

  const canManage = canManagePipettes();
  const labels = { ok: 'В норме', warn: 'Скоро поверка', danger: 'Просрочена', inactive: 'Неактивна' };

  tbody.innerHTML = filtered.map(p => {
    const status = calcStatus(p);
    const next = getNextDate(p);
    const dl = daysLeft(p);
    const daysText = status === 'inactive' ? '' :
      status === 'danger' ? ` (просрочка ${Math.abs(dl)} дн.)` :
      ` (${dl} дн.)`;
    const histCount = (p.history || []).length;
    let actionsHtml = '';
    if (canManage) {
      actionsHtml = `<div class="action-btns">
        <button class="btn btn-secondary btn-sm" onclick="openModal('${p.id}')" title="Редактировать">✏️</button>
        <button class="btn btn-info btn-sm" onclick="openHistoryModal('${p.id}')" title="История поверок (${histCount})">📋</button>
        <button class="btn btn-success btn-sm" onclick="openQuickCalModal('${p.id}')" title="Быстрая поверка">✔️</button>
        <button class="btn btn-danger btn-sm" onclick="deletePipette('${p.id}')" title="Удалить">🗑️</button>
      </div>`;
    } else {
      actionsHtml = `<button class="btn btn-info btn-sm" onclick="openHistoryModal('${p.id}')" title="История поверок (${histCount})">📋</button>`;
    }
    return `<tr>
      <td><strong>${esc(p.id)}</strong>${p.serial ? `<br><small style="color:#94a3b8">S/N: ${esc(p.serial)}</small>` : ''}</td>
      <td>${esc(p.model)}${p.manufacturer ? `<br><small style="color:#94a3b8">${esc(p.manufacturer)}</small>` : ''}</td>
      <td>${p.volume ? esc(p.volume) + ' мкл' : '—'}</td>
      <td>${esc(p.department || '—')}</td>
      <td>${formatDate(p.last_calibration)}</td>
      <td>${formatDate(next)}${daysText ? `<br><small style="color:${status === 'danger' ? '#dc2626' : status === 'warn' ? '#eab308' : '#16a34a'}">${daysText}</small>` : ''}</td>
      <td>${esc(p.responsible || '—')}${p.location ? `<br><small style="color:#94a3b8">${esc(p.location)}</small>` : ''}</td>
      <td><span class="status-badge status-${status}"><span class="status-dot"></span>${labels[status]}</span></td>
      <td>${actionsHtml}</td>
    </tr>`;
  }).join('');

  updateSortArrows();
}

function updateSortArrows() {
  const fields = ['id', 'model', 'volume', 'department', 'lastCalibration', 'nextCalibration', 'responsible'];
  document.querySelectorAll('th .sort-arrow').forEach((el, i) => {
    if (fields[i] === sortField) el.textContent = sortDir > 0 ? '▲' : '▼';
    else el.textContent = '';
  });
}

function sortBy(field) {
  if (sortField === field) sortDir *= -1;
  else { sortField = field; sortDir = 1; }
  render();
}

// ============================================================
// ФИЛЬТРЫ
// ============================================================
let filterState = { status: '', department: '', responsible: '', model: '', manufacturer: '', active: '' };

function toggleFilterPanel() {
  const panel = document.getElementById('filter-panel');
  panel.classList.toggle('show');
}

function applyFilters() {
  filterState.status = document.getElementById('filter-status').value;
  filterState.department = document.getElementById('filter-department').value;
  filterState.responsible = document.getElementById('filter-responsible').value.trim();
  filterState.model = document.getElementById('filter-model').value.trim();
  filterState.manufacturer = document.getElementById('filter-manufacturer').value.trim();
  filterState.active = document.getElementById('filter-active').value;
  document.getElementById('filter-panel').classList.remove('show');
  render();
}

function resetFilters() {
  filterState = { status: '', department: '', responsible: '', model: '', manufacturer: '', active: '' };
  document.getElementById('filter-status').value = '';
  document.getElementById('filter-department').value = '';
  document.getElementById('filter-responsible').value = '';
  document.getElementById('filter-model').value = '';
  document.getElementById('filter-manufacturer').value = '';
  document.getElementById('filter-active').value = '';
  document.getElementById('filter-panel').classList.remove('show');
  render();
}

function getFilteredPipettes() {
  const search = document.getElementById('search').value.toLowerCase();
  const userDept = currentUser && !isAdmin() && !isSeniorLab() ? currentUser.department : null;

  return pipettes.filter(p => {
    const s = `${p.id} ${p.serial || ''} ${p.model} ${p.manufacturer || ''} ${p.department || ''} ${p.responsible || ''}`.toLowerCase();
    const matchSearch = !search || s.includes(search);
    const matchStatus = !filterState.status || calcStatus(p) === filterState.status;
    const matchDept = !filterState.department || p.department === filterState.department;
    const matchResp = !filterState.responsible || (p.responsible || '').toLowerCase().includes(filterState.responsible.toLowerCase());
    const matchModel = !filterState.model || (p.model || '').toLowerCase().includes(filterState.model.toLowerCase());
    const matchManuf = !filterState.manufacturer || (p.manufacturer || '').toLowerCase().includes(filterState.manufacturer.toLowerCase());
    const matchActive = !filterState.active || String(p.active) === filterState.active;
    let matchUserDept = true;
    if (userDept) matchUserDept = p.department === userDept;
    return matchSearch && matchStatus && matchDept && matchResp && matchModel && matchManuf && matchActive && matchUserDept;
  });
}

// ============================================================
// CRUD ПИПЕТОК
// ============================================================
function generateFormFields(data = null) {
  const container = document.getElementById('form-fields-container');
  container.innerHTML = '';

  const fields = [
    { id: 'id', label: 'Внутренний номер', type: 'text', required: true },
    { id: 'serial', label: 'Серийный номер', type: 'text', required: false },
    { id: 'manufacturer', label: 'Производитель', type: 'text', required: false },
    { id: 'model', label: 'Модель', type: 'text', required: true },
    { id: 'volume', label: 'Объём (мкл)', type: 'text', required: false },
    { id: 'department', label: 'Отдел', type: 'select', required: false },
    { id: 'interval', label: 'Межповерочный интервал (мес.)', type: 'number', required: true, default: 12 },
    { id: 'lastCalibration', label: 'Дата последней поверки', type: 'date', required: true },
    { id: 'cert', label: 'Номер свидетельства', type: 'text', required: false },
    { id: 'result', label: 'Результат поверки', type: 'select', required: false, options: ['pass', 'fail', 'wip'] },
    { id: 'active', label: 'Статус эксплуатации', type: 'select', required: false, options: ['true', 'false'] },
    { id: 'responsible', label: 'Ответственный сотрудник', type: 'text', required: false },
    { id: 'location', label: 'Место хранения', type: 'text', required: false },
    { id: 'notes', label: 'Примечание', type: 'textarea', required: false }
  ];

  fields.forEach(f => {
    const div = document.createElement('div');
    div.className = 'form-group';
    const label = document.createElement('label');
    label.textContent = f.label + (f.required ? ' *' : '');
    div.appendChild(label);

    let input;
    const val = data ? (data[f.id] !== undefined ? data[f.id] : (f.default || '')) : (f.default || '');

    if (f.type === 'textarea') {
      input = document.createElement('textarea');
      input.rows = 2;
      input.value = val;
    } else if (f.type === 'select') {
      input = document.createElement('select');
      const opts = f.options || [''];
      opts.forEach(opt => {
        const option = document.createElement('option');
        option.value = opt;
        option.textContent = opt || '—';
        if (String(val) === String(opt)) option.selected = true;
        input.appendChild(option);
      });
    } else {
      input = document.createElement('input');
      input.type = f.type === 'date' ? 'date' : (f.type === 'number' ? 'number' : 'text');
      input.value = val;
    }
    input.id = `p-${f.id}`;
    if (f.required) input.required = true;
    div.appendChild(input);
    container.appendChild(div);
  });
}

function openModal(id) {
  if (!canManagePipettes()) { showToast('Доступ запрещён', 'error'); return; }
  const modal = document.getElementById('modal');
  const title = document.getElementById('modal-title');
  document.getElementById('edit-id').value = '';

  if (id) {
    const p = pipettes.find(x => x.id === id);
    if (!p) return;
    title.textContent = 'Редактировать пипетку';
    document.getElementById('edit-id').value = p.id;
    generateFormFields(p);
  } else {
    title.textContent = 'Добавить пипетку';
    const defaultData = { lastCalibration: new Date().toISOString().slice(0, 10) };
    generateFormFields(defaultData);
  }
  modal.classList.add('active');
}

function closeModal() { document.getElementById('modal').classList.remove('active'); }

async function savePipette(e) {
  e.preventDefault();
  if (!canManagePipettes()) { showToast('Доступ запрещён', 'error'); return; }

  const editId = document.getElementById('edit-id').value;
  const fields = ['id', 'serial', 'manufacturer', 'model', 'volume', 'department', 'interval', 'lastCalibration', 'cert', 'result', 'active', 'responsible', 'location', 'notes'];
  const data = {};
  let valid = true;

  fields.forEach(f => {
    const el = document.getElementById(`p-${f}`);
    if (el) {
      const val = el.value;
      data[f] = val;
      if (f === 'id' || f === 'model' || f === 'interval' || f === 'lastCalibration') {
        if (!val) {
          valid = false;
          el.style.borderColor = '#dc2626';
        } else {
          el.style.borderColor = '';
        }
      }
    }
  });

  if (!valid) { showToast('Заполните обязательные поля', 'error'); return; }
  if (data.lastCalibration && new Date(data.lastCalibration) > new Date()) {
    showToast('Дата поверки не может быть в будущем', 'error');
    return;
  }

  data.interval = parseInt(data.interval) || 12;
  data.active = data.active === 'true' || data.active === true;
  if (data.lastCalibration) data.lastResult = data.result || 'pass';

  try {
    if (editId) {
      await apiRequest(`/pipettes/${editId}`, 'PUT', data);
      showToast('Пипетка обновлена', 'success');
    } else {
      await apiRequest('/pipettes', 'POST', data);
      showToast('Пипетка добавлена', 'success');
    }
    await loadPipetteData();
    closeModal();
  } catch (error) {
    showToast(error.message || 'Ошибка сохранения', 'error');
  }
}

async function deletePipette(id) {
  if (!canManagePipettes()) { showToast('Доступ запрещён', 'error'); return; }
  if (!confirm(`Удалить пипетку ${id} со всей историей?`)) return;
  try {
    await apiRequest(`/pipettes/${id}`, 'DELETE');
    showToast('Пипетка удалена', 'success');
    await loadPipetteData();
  } catch (error) {
    showToast(error.message || 'Ошибка удаления', 'error');
  }
}

// ============================================================
// БЫСТРАЯ ПОВЕРКА
// ============================================================
function openQuickCalModal(id) {
  if (!canManagePipettes()) { showToast('Доступ запрещён', 'error'); return; }
  const p = pipettes.find(x => x.id === id);
  if (!p) { showToast('Пипетка не найдена', 'error'); return; }
  document.getElementById('quick-cal-id').value = id;
  document.getElementById('quick-cal-pipette-info').innerHTML = `<strong>${esc(p.id)}</strong> — ${esc(p.model)} (${esc(p.department || 'без отдела')})`;
  document.getElementById('quick-cal-date').value = new Date().toISOString().slice(0, 10);
  document.getElementById('quick-cal-cert').value = '';
  document.getElementById('quick-cal-result').value = 'pass';
  document.getElementById('quick-cal-org').value = '';
  document.getElementById('quick-cal-note').value = '';
  document.getElementById('quick-cal-modal').classList.add('active');
}

function closeQuickCalModal() {
  document.getElementById('quick-cal-modal').classList.remove('active');
}

async function saveQuickCalibration() {
  if (!canManagePipettes()) { showToast('Доступ запрещён', 'error'); return; }
  const id = document.getElementById('quick-cal-id').value;
  const date = document.getElementById('quick-cal-date').value;
  const cert = document.getElementById('quick-cal-cert').value.trim();
  const result = document.getElementById('quick-cal-result').value;
  const org = document.getElementById('quick-cal-org').value.trim();
  const note = document.getElementById('quick-cal-note').value.trim();

  if (!date) { showToast('Укажите дату поверки', 'error'); return; }
  if (date > new Date().toISOString().slice(0, 10)) { showToast('Дата не может быть в будущем', 'error'); return; }

  try {
    await apiRequest(`/pipettes/${id}/calibration`, 'POST', { date, cert, result, org, note });
    showToast('Поверка зарегистрирована', 'success');
    closeQuickCalModal();
    await loadPipetteData();
  } catch (error) {
    showToast(error.message || 'Ошибка сохранения', 'error');
  }
}

// ============================================================
// ИСТОРИЯ
// ============================================================
async function openHistoryModal(id) {
  const p = pipettes.find(x => x.id === id);
  if (!p) return;
  currentHistoryId = id;
  document.getElementById('history-title').textContent = `История поверок — ${p.id}`;
  await renderHistoryContent(p);
  closeCalibrationForm();
  document.getElementById('history-modal').classList.add('active');
}

function closeHistoryModal() {
  document.getElementById('history-modal').classList.remove('active');
  currentHistoryId = null;
  closeCalibrationForm();
}

async function renderHistoryContent(p) {
  const content = document.getElementById('history-content');
  const next = getNextDate(p);
  const status = calcStatus(p);
  const statusLabels = { ok: 'В норме', warn: 'Скоро поверка', danger: 'Просрочена', inactive: 'Неактивна' };

  let history = [];
  try {
    history = await apiRequest(`/pipettes/${p.id}/calibration`);
  } catch (error) {
    console.error('Error loading history:', error);
  }

  let infoHtml = `
    <div class="info-grid">
      <div><label>Модель</label><span>${esc(p.model)}${p.manufacturer ? ' (' + esc(p.manufacturer) + ')' : ''}</span></div>
      <div><label>Серийный номер</label><span>${esc(p.serial || '—')}</span></div>
      <div><label>Объём</label><span>${p.volume ? esc(p.volume) + ' мкл' : '—'}</span></div>
      <div><label>Отдел</label><span>${esc(p.department || '—')}</span></div>
      <div><label>МПИ</label><span>${p.interval} мес.</span></div>
      <div><label>Последняя поверка</label><span>${formatDate(p.last_calibration)}</span></div>
      <div><label>Следующая поверка</label><span>${formatDate(next)}</span></div>
      <div><label>Статус</label><span><span class="status-badge status-${status}"><span class="status-dot"></span>${statusLabels[status]}</span></span></div>
      <div><label>Ответственный</label><span>${esc(p.responsible || '—')}</span></div>
      <div><label>Место хранения</label><span>${esc(p.location || '—')}</span></div>
    </div>
  `;

  let histHtml = '';
  const resultLabels = { pass: 'Годен', fail: 'Брак', wip: 'В процессе' };

  if (history.length === 0) {
    histHtml = '<div class="history-empty">Записей о поверках пока нет.<br>Нажмите «Добавить поверку», чтобы создать первую.</div>';
  } else {
    histHtml = '<div class="history-header"><h3>Журнал поверок (' + history.length + ')</h3></div>';
    histHtml += '<div class="timeline" style="position:relative;padding-left:28px;margin-top:15px;">';
    history.forEach(h => {
      const itemClass = h.result === 'fail' ? 'danger' : (h.result === 'wip' ? 'warn' : '');
      histHtml += `<div class="timeline-item ${itemClass}" style="position:relative;padding-bottom:20px;border-left:2px solid #e2e8f0;padding-left:20px;">
        <div style="font-weight:600;font-size:.85rem;color:#475569;">${formatDate(h.date)}</div>
        ${h.cert ? `<div style="display:inline-block;background:#e0f2fe;color:#0369a1;padding:2px 10px;border-radius:6px;font-size:.78rem;margin-top:4px;">📄 Свидетельство № ${esc(h.cert)}</div>` : ''}
        <span style="display:inline-block;padding:2px 10px;border-radius:6px;font-size:.78rem;margin-top:4px;margin-left:6px;${h.result === 'pass' ? 'background:#dcfce7;color:#166534;' : h.result === 'fail' ? 'background:#fee2e2;color:#991b1b;' : 'background:#e0f2fe;color:#0369a1;'}">${resultLabels[h.result] || h.result}</span>
        ${h.org ? `<div style="font-size:.85rem;color:#64748b;margin-top:4px;">Организация: ${esc(h.org)}</div>` : ''}
        ${h.note ? `<div style="font-size:.85rem;color:#64748b;margin-top:4px;">${esc(h.note)}</div>` : ''}
      </div>`;
    });
    histHtml += '</div>';
  }

  content.innerHTML = infoHtml + histHtml;
}

function openCalibrationForm() {
  if (!canManagePipettes()) { showToast('Доступ запрещён', 'error'); return; }
  document.getElementById('calibration-form-wrap').style.display = 'block';
  document.getElementById('cal-date').value = new Date().toISOString().slice(0, 10);
  document.getElementById('cal-cert').value = '';
  document.getElementById('cal-result').value = 'pass';
  document.getElementById('cal-org').value = '';
  document.getElementById('cal-note').value = '';
}

function closeCalibrationForm() {
  document.getElementById('calibration-form-wrap').style.display = 'none';
}

async function addCalibrationRecord() {
  if (!canManagePipettes()) { showToast('Доступ запрещён', 'error'); return; }
  const date = document.getElementById('cal-date').value;
  const cert = document.getElementById('cal-cert').value.trim();
  const result = document.getElementById('cal-result').value;
  const org = document.getElementById('cal-org').value.trim();
  const note = document.getElementById('cal-note').value.trim();

  if (!date) { showToast('Укажите дату поверки', 'error'); return; }
  if (date > new Date().toISOString().slice(0, 10)) { showToast('Дата не может быть в будущем', 'error'); return; }

  try {
    await apiRequest(`/pipettes/${currentHistoryId}/calibration`, 'POST', { date, cert, result, org, note });
    showToast('Запись о поверке добавлена', 'success');
    closeCalibrationForm();
    await loadPipetteData();
    const p = pipettes.find(x => x.id === currentHistoryId);
    if (p) await renderHistoryContent(p);
  } catch (error) {
    showToast(error.message || 'Ошибка сохранения', 'error');
  }
}

// ============================================================
// ЭКСПОРТ
// ============================================================
async function exportToExcel() {
  if (!isAuthenticated()) { showToast('Требуется авторизация', 'error'); return; }
  const data = getFilteredPipettes();
  if (data.length === 0) { showToast('Нет данных для экспорта', 'error'); return; }

  const headers = ['ID', 'Серийный', 'Производитель', 'Модель', 'Объём', 'Отдел', 'Дата поверки', 'Следующая', 'МПИ', 'Дней', 'Ответственный', 'Место', 'Статус', 'Свидетельство', 'Примечание'];
  const labels = { ok: 'В норме', warn: 'Скоро поверка', danger: 'Просрочена', inactive: 'Неактивна' };

  const csvLines = [headers.join(';')];
  data.forEach(p => {
    const next = getNextDate(p);
    const status = calcStatus(p);
    const dl = daysLeft(p);
    const dlText = status === 'inactive' ? '—' : (dl < 0 ? 'просрочка ' + Math.abs(dl) + ' дн.' : dl + ' дн.');
    const row = [
      p.id, p.serial || '', p.manufacturer || '', p.model, p.volume || '',
      p.department || '', formatDate(p.last_calibration), formatDate(next),
      p.interval || '', dlText, p.responsible || '', p.location || '',
      labels[status] || status, p.cert || '', p.notes || ''
    ];
    const line = row.map(v => {
      const s = String(v).replace(/"/g, '""');
      return /[";]/.test(s) ? '"' + s + '"' : s;
    }).join(';');
    csvLines.push(line);
  });

  const bom = '\uFEFF';
  const blob = new Blob([bom + csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pipettes_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Файл Excel (CSV) сохранён', 'success');
}

function exportToPDF() {
  if (!isAuthenticated()) { showToast('Требуется авторизация', 'error'); return; }
  const data = getFilteredPipettes();
  if (data.length === 0) { showToast('Нет данных для экспорта', 'error'); return; }

  const labels = { ok: 'В норме', warn: 'Скоро поверка', danger: 'Просрочена', inactive: 'Неактивна' };
  const today = new Date().toLocaleDateString('ru-RU');
  const user = currentUser ? currentUser.fullName : '';

  const rows = data.map(p => {
    const next = getNextDate(p);
    const status = calcStatus(p);
    const dl = daysLeft(p);
    const dlText = status === 'inactive' ? '—'
      : (dl < 0 ? 'просрочка ' + Math.abs(dl) + ' дн.' : dl + ' дн.');
    return `
      <tr>
        <td>${esc(p.id)}</td>
        <td>${esc(p.model)}${p.manufacturer ? '<br><small>' + esc(p.manufacturer) + '</small>' : ''}</td>
        <td>${esc(p.serial || '—')}</td>
        <td>${p.volume ? esc(p.volume) + ' мкл' : '—'}</td>
        <td>${esc(p.department || '—')}</td>
        <td>${formatDate(p.last_calibration)}</td>
        <td>${formatDate(next)}${dlText !== '—' ? '<br><small>' + dlText + '</small>' : ''}</td>
        <td>${esc(p.responsible || '—')}</td>
        <td><span class="status-${status}">${labels[status]}</span></td>
      </tr>`;
  }).join('');

  const win = window.open('', '_blank');
  win.document.write(`
    <!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8">
    <title>Реестр пипеток — ${today}</title>
    <style>
      @page { size: A4 landscape; margin: 15mm 10mm; }
      * { box-sizing: border-box; }
      body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 9pt; color: #1a1a2e; }
      h1 { font-size: 14pt; margin: 0 0 4px; color: #1e293b; }
      .meta { font-size: 9pt; color: #64748b; margin-bottom: 12px; border-bottom: 1px solid #cbd5e1; padding-bottom: 8px; }
      .meta b { color: #1e293b; }
      table { width: 100%; border-collapse: collapse; font-size: 8.5pt; }
      th { background: #1e293b; color: #fff; padding: 6px 5px; text-align: left; font-size: 8pt; text-transform: uppercase; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      td { padding: 5px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
      tr:nth-child(even) td { background: #f8fafc; }
      small { color: #94a3b8; font-size: 7.5pt; }
      .status-ok { color: #16a34a; font-weight: 600; }
      .status-warn { color: #ca8a04; font-weight: 600; }
      .status-danger { color: #dc2626; font-weight: 700; }
      .status-inactive { color: #94a3b8; }
      .footer { margin-top: 15px; font-size: 8pt; color: #94a3b8; display: flex; justify-content: space-between; border-top: 1px solid #e2e8f0; padding-top: 8px; }
      .footer .sign { margin-top: 20px; }
    </style></head><body>
      <h1>🔬 Реестр пипеток — КГБУЗ Краевая клиническая больница КДЛ</h1>
      <div class="meta">Дата: <b>${today}</b> · Записей: <b>${data.length}</b> · Сформировал: <b>${esc(user)}</b></div>
      <table>
        <thead><tr>
          <th style="width:8%">ID</th><th style="width:16%">Модель / Производитель</th>
          <th style="width:10%">Серийный</th><th style="width:8%">Объём</th>
          <th style="width:14%">Отдел</th><th style="width:10%">Поверка</th>
          <th style="width:12%">Следующая</th><th style="width:12%">Ответственный</th>
          <th style="width:10%">Статус</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="footer">
        <div>Документ сформирован автоматически</div>
        <div class="sign">Подпись: _______________</div>
      </div>
    </body></html>`);
  win.document.close();
  setTimeout(() => { win.focus(); win.print(); }, 300);
  showToast('Окно печати открыто — выберите «Сохранить как PDF»', 'success');
}
// ============================================================
// ВЫПАДАЮЩЕЕ МЕНЮ ЭКСПОРТА
// ============================================================
function toggleExportMenu(e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById('export-menu');
  menu.classList.toggle('show');
}

function closeExportMenu() {
  const menu = document.getElementById('export-menu');
  if (menu) menu.classList.remove('show');
}

// Закрываем меню при клике вне него
document.addEventListener('click', (e) => {
  const dropdown = document.getElementById('export-dropdown');
  if (dropdown && !dropdown.contains(e.target)) {
    closeExportMenu();
  }
});
// ============================================================
// НАПОМИНАНИЕ
// ============================================================
function checkReminder() {
  const lastShown = localStorage.getItem('pipette_last_reminder');
  const today = new Date().toISOString().slice(0, 10);
  if (lastShown === today) return;

  const dangerList = pipettes.filter(p => calcStatus(p) === 'danger');
  const warnList = pipettes.filter(p => calcStatus(p) === 'warn');
  if (dangerList.length === 0 && warnList.length === 0) return;

  setTimeout(() => showReminder(dangerList, warnList), 600);
}

function showReminder(dangerList, warnList) {
  const icon = document.getElementById('reminder-icon');
  const title = document.getElementById('reminder-title');
  const subtitle = document.getElementById('reminder-subtitle');
  const body = document.getElementById('reminder-body');

  if (dangerList.length > 0) {
    icon.textContent = '🚨';
    title.textContent = 'Просрочены поверки!';
    title.style.color = '#dc2626';
    subtitle.textContent = `${dangerList.length} ${dangerList.length === 1 ? 'пипетка требует' : 'пипеток требуют'} срочной поверки`;
  } else {
    icon.textContent = '🔔';
    title.textContent = 'Приближаются сроки поверки';
    title.style.color = '#eab308';
    subtitle.textContent = `${warnList.length} ${warnList.length === 1 ? 'пипетка подходит' : 'пипеток подходят'} к сроку поверки в течение ${settings.warnDays} дн.`;
  }

  let html = '';
  if (dangerList.length > 0) {
    html += `<div class="reminder-section"><div class="reminder-section-title danger">🚨 Просрочены (${dangerList.length})</div><ul class="reminder-list">`;
    dangerList.sort((a, b) => daysLeft(a) - daysLeft(b)).forEach(p => {
      const dl = daysLeft(p);
      html += `<li class="danger">
        <div class="pip-info"><div class="pip-id">${esc(p.id)} — ${esc(p.model)}</div>
        <div class="pip-detail">${esc(p.department || 'без отдела')} · ${esc(p.responsible || '—')}</div></div>
        <div class="pip-days">просрочка ${Math.abs(dl)} дн.</div>
      </li>`;
    });
    html += '</ul></div>';
  }
  if (warnList.length > 0) {
    html += `<div class="reminder-section"><div class="reminder-section-title warn">⚠️ Скоро поверка (${warnList.length})</div><ul class="reminder-list">`;
    warnList.sort((a, b) => daysLeft(a) - daysLeft(b)).forEach(p => {
      const dl = daysLeft(p);
      html += `<li class="warn">
        <div class="pip-info"><div class="pip-id">${esc(p.id)} — ${esc(p.model)}</div>
        <div class="pip-detail">${esc(p.department || 'без отдела')} · ${esc(p.responsible || '—')}</div></div>
        <div class="pip-days">${dl} дн.</div>
      </li>`;
    });
    html += '</ul></div>';
  }
  body.innerHTML = html;
  document.getElementById('reminder-overlay').classList.add('active');
}

function closeReminder(confirmed) {
  document.getElementById('reminder-overlay').classList.remove('active');
  if (confirmed) {
    localStorage.setItem('pipette_last_reminder', new Date().toISOString().slice(0, 10));
  }
}

// ============================================================
// UI АВТОРИЗАЦИИ
// ============================================================
function renderAuthUI() {
  const authContainer = document.getElementById('auth-container');
  const mainContent = document.getElementById('main-content');

  if (isAuthenticated()) {
    authContainer.classList.add('hidden');
    mainContent.classList.add('visible');
    document.getElementById('user-fullname').textContent = currentUser.fullName;
    let posText = currentUser.position + (currentUser.role === 'admin' ? ' (админ)' : currentUser.role === 'senior_lab' ? ' (ст. лаборант)' : '');
    if (currentUser.department) posText += ' · ' + currentUser.department;
    document.getElementById('user-position').textContent = posText;

    document.body.classList.toggle('admin-mode', isAdmin());
    document.body.classList.toggle('senior-mode', isSeniorLab() || isAdmin());

    document.querySelectorAll('.admin-only').forEach(el => el.style.display = isAdmin() ? 'inline-flex' : 'none');
    document.querySelectorAll('.senior-only').forEach(el => el.style.display = (isAdmin() || isSeniorLab()) ? 'inline-flex' : 'none');

    const actionsHeader = document.getElementById('actions-header');
    if (actionsHeader) actionsHeader.style.display = (isAdmin() || isSeniorLab()) ? '' : 'none';
  } else {
    authContainer.classList.remove('hidden');
    mainContent.classList.remove('visible');
    document.body.classList.remove('admin-mode', 'senior-mode');
  }
}

// ============================================================
// ИНИЦИАЛИЗАЦИЯ
// ============================================================
document.getElementById('search').addEventListener('input', render);
document.getElementById('modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
document.getElementById('quick-cal-modal').addEventListener('click', e => { if (e.target.id === 'quick-cal-modal') closeQuickCalModal(); });
document.getElementById('history-modal').addEventListener('click', e => { if (e.target.id === 'history-modal') closeHistoryModal(); });

const session = getSession();
if (session) {
  authToken = session.token;
  currentUser = session.user;
  renderAuthUI();
  loadPipetteData();
}
// ============================================================
// ИМПОРТ ДАННЫХ
// ============================================================
function openImportModal() {
  if (!canManagePipettes()) { showToast('Доступ запрещён', 'error'); return; }
  document.getElementById('import-modal').classList.add('active');
}
function closeImportModal() {
  document.getElementById('import-modal').classList.remove('active');
  document.getElementById('import-file').value = '';
}

async function handleImport() {
  const format = document.getElementById('import-format').value;
  const fileInput = document.getElementById('import-file');
  const file = fileInput.files[0];
  if (!file) { showToast('Выберите файл', 'error'); return; }

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      let imported = [];
      if (format === 'json') {
        imported = JSON.parse(e.target.result);
        if (!Array.isArray(imported)) throw new Error('JSON должен быть массивом');
      } else {
        const text = e.target.result;
        const lines = text.split(/\r?\n/).filter(l => l.trim());
        if (lines.length < 2) throw new Error('Пустой файл');
        const sep = lines[0].includes(';') ? ';' : ',';
        const headers = lines[0].split(sep).map(h => h.trim().replace(/^"|"$/g, ''));
        imported = lines.slice(1).map(line => {
          const vals = line.split(sep).map(v => v.trim().replace(/^"|"$/g, ''));
          const obj = {};
          headers.forEach((h, i) => obj[h] = vals[i] || '');
          return obj;
        });
      }

      let added = 0;
      for (const item of imported) {
        const id = item.id || item.ID || '';
        const model = item.model || item['Модель'] || '';
        if (!id || !model) continue;
        try {
          await apiRequest('/pipettes', 'POST', {
            id: String(id).trim(),
            model: String(model).trim(),
            serial: item.serial || item['Серийный'] || '',
            manufacturer: item.manufacturer || item['Производитель'] || '',
            volume: String(item.volume || item['Объём'] || '').replace(' мкл', ''),
            department: item.department || item['Отдел'] || '',
            interval: parseInt(item.interval || item['МПИ'] || 12) || 12,
            lastCalibration: item.lastCalibration || item.last_calibration || item['Дата поверки'] || '',
            cert: item.cert || item['Свидетельство'] || '',
            result: item.result || item.lastResult || 'pass',
            active: item.active !== false && item.active !== 0 && item.active !== 'false',
            responsible: item.responsible || item['Ответственный'] || '',
            location: item.location || item['Место'] || '',
            notes: item.notes || item['Примечание'] || ''
          });
          added++;
        } catch (err) {
          console.warn('Пропущено:', id, err.message);
        }
      }
      await loadPipetteData();
      closeImportModal();
      showToast(`Импортировано записей: ${added}`, 'success');
    } catch (err) {
      showToast('Ошибка импорта: ' + err.message, 'error');
    }
  };
  reader.readAsText(file, 'UTF-8');
}

// ============================================================
// НАСТРОЙКИ
// ============================================================
function openSettingsModal() {
  if (!isAdmin()) { showToast('Только для администратора', 'error'); return; }
  document.getElementById('settings-modal').classList.add('active');
  switchSettingsTab('users');
}
function closeSettingsModal() {
  document.getElementById('settings-modal').classList.remove('active');
}

async function switchSettingsTab(tab) {
  document.querySelectorAll('.settings-tabs .tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  const container = document.getElementById('settings-content');
  container.innerHTML = '<p style="text-align:center;color:#94a3b8;">Загрузка…</p>';

  if (tab === 'users') await renderUsersTab();
  else if (tab === 'departments') await renderDepartmentsTab();
  else if (tab === 'system') await renderSystemTab();
  else if (tab === 'log') await renderLogTab();
}

// ----- Пользователи -----
async function renderUsersTab() {
  const container = document.getElementById('settings-content');
  try {
    const users = await apiRequest('/users');
    let html = `
      <h3 style="margin-bottom:12px;">Пользователи системы</h3>
      <table class="users-table">
        <thead><tr>
          <th>Логин</th><th>ФИО</th><th>Должность</th><th>Отдел</th><th>Роль</th><th>Действия</th>
        </tr></thead><tbody>`;
    const roleLabels = { user: 'Пользователь', senior_lab: 'Ст. лаборант', admin: 'Администратор' };
    for (const u of users) {
      html += `<tr>
        <td>${esc(u.login)}</td>
        <td>${esc(u.full_name)}</td>
        <td>${esc(u.position)}</td>
        <td>${esc(u.department || '—')}</td>
        <td>${roleLabels[u.role] || u.role}</td>
        <td class="actions">
          <button class="btn btn-danger btn-sm" onclick="deleteUserSettings('${u.id}')">🗑️</button>
        </td>
      </tr>`;
    }
    html += `</tbody></table>
      <hr style="margin:20px 0;">
      <h4 style="margin-bottom:12px;">Добавить пользователя</h4>
      <div class="form-row">
        <div class="form-group"><label>Логин *</label><input id="new-user-login" placeholder="login"></div>
        <div class="form-group"><label>Пароль *</label><input id="new-user-password" placeholder="пароль"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>ФИО *</label><input id="new-user-fullname" placeholder="Иванов Иван Иванович"></div>
        <div class="form-group"><label>Должность *</label><input id="new-user-position" placeholder="Лаборант"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Отдел</label><input id="new-user-department" placeholder="Отдел"></div>
        <div class="form-group"><label>Роль</label>
          <select id="new-user-role">
            <option value="user">Пользователь</option>
            <option value="senior_lab">Старший лаборант</option>
            <option value="admin">Администратор</option>
          </select>
        </div>
      </div>
      <button class="btn btn-success" onclick="createUserFromSettings()">➕ Создать пользователя</button>
    `;
    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = '<p style="color:#dc2626;">Ошибка: ' + err.message + '</p>';
  }
}

async function createUserFromSettings() {
  const login = document.getElementById('new-user-login').value.trim();
  const password = document.getElementById('new-user-password').value.trim();
  const fullName = document.getElementById('new-user-fullname').value.trim();
  const position = document.getElementById('new-user-position').value.trim();
  const department = document.getElementById('new-user-department').value.trim();
  const role = document.getElementById('new-user-role').value;
  if (!login || !password || !fullName || !position) {
    showToast('Заполните обязательные поля', 'error'); return;
  }
  try {
    await apiRequest('/users', 'POST', { login, password, fullName, position, department, role, extraPermissions: [] });
    showToast('Пользователь создан', 'success');
    renderUsersTab();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteUserSettings(id) {
  if (!confirm('Удалить пользователя?')) return;
  try {
    await apiRequest('/users/' + id, 'DELETE');
    showToast('Пользователь удалён', 'success');
    renderUsersTab();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ----- Отделы -----
async function renderDepartmentsTab() {
  const container = document.getElementById('settings-content');
  try {
    const depts = await apiRequest('/settings/departments');
    let html = `<h3 style="margin-bottom:12px;">Список отделов</h3>`;
    depts.forEach((d, i) => {
      html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border-bottom:1px solid #e2e8f0;">
        <span>${esc(d)}</span>
        <button class="btn btn-danger btn-sm" onclick="deleteDept(${i})">🗑️</button>
      </div>`;
    });
    html += `
      <hr style="margin:20px 0;">
      <div class="form-row">
        <div class="form-group" style="flex:1;">
          <label>Новый отдел</label>
          <input id="new-dept-name" placeholder="Название отдела">
        </div>
        <div class="form-group" style="flex:0;display:flex;align-items:flex-end;">
          <button class="btn btn-success" onclick="addDept()">➕ Добавить</button>
        </div>
      </div>
    `;
    container.innerHTML = html;
    // Сохраняем список в window для последующих операций
    window._depts = depts;
  } catch (err) {
    container.innerHTML = '<p style="color:#dc2626;">Ошибка: ' + err.message + '</p>';
  }
}

async function addDept() {
  const name = document.getElementById('new-dept-name').value.trim();
  if (!name) { showToast('Введите название', 'error'); return; }
  const depts = [...window._depts, name];
  await apiRequest('/settings/departments', 'PUT', depts);
  showToast('Отдел добавлен', 'success');
  renderDepartmentsTab();
  loadDepartments();
}

async function deleteDept(idx) {
  if (!confirm('Удалить отдел?')) return;
  const depts = window._depts.filter((_, i) => i !== idx);
  await apiRequest('/settings/departments', 'PUT', depts);
  showToast('Отдел удалён', 'success');
  renderDepartmentsTab();
  loadDepartments();
}

// ----- Системные настройки -----
async function renderSystemTab() {
  const container = document.getElementById('settings-content');
  try {
    const settingsData = await apiRequest('/settings/system');
    container.innerHTML = `
      <h3 style="margin-bottom:12px;">Системные настройки</h3>
      <div class="form-group">
        <label>Порог предупреждения о поверке (дней)</label>
        <input type="number" id="warn-days-input" value="${esc(settingsData.warn_days || '30')}">
        <small style="color:#64748b;">За сколько дней до окончания срока показывать статус «Скоро поверка»</small>
      </div>
      <button class="btn btn-success" onclick="saveSystemSettings()">💾 Сохранить</button>
    `;
  } catch (err) {
    container.innerHTML = '<p style="color:#dc2626;">Ошибка: ' + err.message + '</p>';
  }
}

async function saveSystemSettings() {
  const warnDays = document.getElementById('warn-days-input').value;
  await apiRequest('/settings/system', 'PUT', { warn_days: String(warnDays) });
  settings.warnDays = parseInt(warnDays) || 30;
  showToast('Настройки сохранены', 'success');
  render();
}

// ----- Журнал -----
async function renderLogTab() {
  const container = document.getElementById('settings-content');
  try {
    const logs = await apiRequest('/log?limit=200');
    let html = `
      <h3 style="margin-bottom:12px;">Журнал действий (${logs.length})</h3>
      <button class="btn btn-danger btn-sm" onclick="clearLogFromSettings()" style="margin-bottom:12px;">🗑️ Очистить</button>
      <div style="max-height:400px;overflow-y:auto;">
        <table class="log-table">
          <thead><tr><th>Время</th><th>Пользователь</th><th>Действие</th><th>Детали</th></tr></thead>
          <tbody>`;
    if (!logs.length) {
      html += '<tr><td colspan="4" style="text-align:center;padding:20px;color:#94a3b8;">Пусто</td></tr>';
    } else {
      for (const l of logs) {
        html += `<tr>
          <td class="timestamp">${new Date(l.timestamp).toLocaleString('ru-RU')}</td>
          <td class="user">${esc(l.user_full_name)}</td>
          <td class="action">${esc(l.action)}</td>
          <td class="details">${esc(l.details || '')}</td>
        </tr>`;
      }
    }
    html += '</tbody></table></div>';
    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = '<p style="color:#dc2626;">Ошибка: ' + err.message + '</p>';
  }
}

async function clearLogFromSettings() {
  if (!confirm('Очистить весь журнал?')) return;
  await apiRequest('/log', 'DELETE');
  showToast('Журнал очищен', 'success');
  renderLogTab();
}

// Закрытие модалок по клику на оверлей
document.getElementById('import-modal').addEventListener('click', e => {
  if (e.target.id === 'import-modal') closeImportModal();
});
document.getElementById('settings-modal').addEventListener('click', e => {
  if (e.target.id === 'settings-modal') closeSettingsModal();
});

console.log('🔬 Система учёта пипеток запущена');
console.log('👤 admin/admin, senior/senior, user/user');
