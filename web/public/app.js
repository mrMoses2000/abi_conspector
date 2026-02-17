const state = {
  token: localStorage.getItem('conspector_web_token') || '',
  user: null,
  conspects: [],
  health: null
};

const refs = {
  authCard: document.getElementById('auth-card'),
  appCard: document.getElementById('app-card'),
  adminCard: document.getElementById('admin-card'),
  tabLogin: document.getElementById('tab-login'),
  tabRegister: document.getElementById('tab-register'),
  loginForm: document.getElementById('login-form'),
  registerForm: document.getElementById('register-form'),
  loginEmail: document.getElementById('login-email'),
  loginPassword: document.getElementById('login-password'),
  registerEmail: document.getElementById('register-email'),
  registerPassword: document.getElementById('register-password'),
  authStatus: document.getElementById('auth-status'),
  appStatus: document.getElementById('app-status'),
  adminStatus: document.getElementById('admin-status'),
  userLine: document.getElementById('user-line'),
  conspectsBody: document.getElementById('conspects-body'),
  usersBody: document.getElementById('users-body'),
  refreshBtn: document.getElementById('refresh-btn'),
  logoutBtn: document.getElementById('logout-btn'),
  notionForm: document.getElementById('notion-form'),
  notionRecordingId: document.getElementById('notion-recording-id'),
  notionPageTitle: document.getElementById('notion-page-title')
};

function setStatus(node, text, isError = false) {
  node.textContent = text;
  node.classList.toggle('error', isError);
}

function setLoginTab(activeLogin) {
  refs.tabLogin.classList.toggle('active', activeLogin);
  refs.tabRegister.classList.toggle('active', !activeLogin);
  refs.loginForm.classList.toggle('hidden', !activeLogin);
  refs.registerForm.classList.toggle('hidden', activeLogin);
}

function showAuthScreen() {
  refs.authCard.classList.remove('hidden');
  refs.appCard.classList.add('hidden');
  refs.adminCard.classList.add('hidden');
}

function showAppScreen() {
  refs.authCard.classList.add('hidden');
  refs.appCard.classList.remove('hidden');
  if (state.user?.role === 'admin') {
    refs.adminCard.classList.remove('hidden');
  } else {
    refs.adminCard.classList.add('hidden');
  }
}

function formatDuration(seconds) {
  const sec = Number.parseInt(String(seconds || 0), 10);
  if (!Number.isFinite(sec) || sec <= 0) {
    return '-';
  }
  const hh = Math.floor(sec / 3600);
  const mm = Math.floor((sec % 3600) / 60);
  const ss = sec % 60;
  if (hh > 0) {
    return `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  }
  return `${mm}:${String(ss).padStart(2, '0')}`;
}

function formatDate(value) {
  if (!value) {
    return '-';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }
  return date.toLocaleString('ru-RU');
}

function saveToken(token) {
  state.token = token || '';
  if (state.token) {
    localStorage.setItem('conspector_web_token', state.token);
  } else {
    localStorage.removeItem('conspector_web_token');
  }
}

async function parseErrorResponse(response) {
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('application/json')) {
    const payload = await response.json().catch(() => ({}));
    const errorObj = payload?.error || payload;
    const message = errorObj?.message || payload?.message || `HTTP ${response.status}`;
    const code = errorObj?.code || payload?.code || `HTTP_${response.status}`;
    const details = errorObj?.details || payload?.details || null;
    return { message, code, details };
  }
  const text = await response.text().catch(() => '');
  return {
    message: text || `HTTP ${response.status}`,
    code: `HTTP_${response.status}`,
    details: null
  };
}

async function apiRequest(path, options = {}) {
  const { method = 'GET', body, auth = true, responseType = 'json' } = options;
  const headers = {};
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (auth && state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }

  const response = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  if (!response.ok) {
    const error = await parseErrorResponse(response);
    const wrapped = new Error(error.message || 'Request failed');
    wrapped.code = error.code;
    wrapped.status = response.status;
    wrapped.details = error.details;
    throw wrapped;
  }

  if (responseType === 'blob') {
    return response.blob();
  }
  if (responseType === 'text') {
    return response.text();
  }
  if (response.status === 204) {
    return null;
  }
  return response.json();
}

function ensureAuthError(error) {
  return error?.code === 'AUTH_REQUIRED' || error?.code === 'AUTH_EXPIRED' || error?.status === 401;
}

function renderConspects(items) {
  refs.conspectsBody.textContent = '';
  if (!Array.isArray(items) || items.length === 0) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 5;
    cell.textContent = 'Пока нет результатов. Добавьте аудио в desktop app.';
    row.appendChild(cell);
    refs.conspectsBody.appendChild(row);
    return;
  }

  for (const item of items) {
    const row = document.createElement('tr');

    const fileCell = document.createElement('td');
    fileCell.setAttribute('data-label', 'Файл');
    const title = document.createElement('div');
    title.textContent = item.fileName || item.recordingId;
    const meta = document.createElement('div');
    meta.className = 'muted';
    meta.style.fontSize = '12px';
    meta.style.fontFamily = "'JetBrains Mono', monospace";
    meta.textContent = `${item.recordingId} · ${formatDuration(item.durationSec)} · ${formatDate(item.createdAt)}`;
    fileCell.append(title, meta);

    const statusCell = document.createElement('td');
    statusCell.setAttribute('data-label', 'Статус');
    const statusStr = (item.status || 'unknown').toLowerCase();
    const dot = document.createElement('span');
    dot.className = `status-dot ${statusStr}`;
    const statusBadge = document.createElement('span');
    const badgeClass = statusStr === 'done' ? 'done'
      : statusStr === 'failed' ? 'failed'
        : (statusStr === 'processing' || statusStr === 'running') ? 'processing'
          : '';
    statusBadge.className = `badge ${badgeClass}`;
    statusBadge.textContent = item.status || 'unknown';
    statusCell.append(dot, statusBadge);

    const stageCell = document.createElement('td');
    stageCell.setAttribute('data-label', 'Этап');
    stageCell.textContent = item.stage || '-';

    const warningCell = document.createElement('td');
    warningCell.setAttribute('data-label', 'Warning');
    if (item.mockFallbackUsed) {
      const warnBadge = document.createElement('span');
      warnBadge.className = 'badge warn';
      warnBadge.textContent = 'mock fallback used';
      warningCell.appendChild(warnBadge);
      warningCell.appendChild(document.createElement('br'));
    }
    const warningText = item.errorMessage || item.warning || '-';
    const warningLine = document.createElement('span');
    warningLine.textContent = warningText;
    warningCell.appendChild(warningLine);

    const actionsCell = document.createElement('td');
    actionsCell.setAttribute('data-label', 'Действия');
    const htmlButton = document.createElement('button');
    htmlButton.className = 'btn secondary';
    htmlButton.type = 'button';
    htmlButton.textContent = 'HTML';
    htmlButton.disabled = !item.htmlAvailable;
    htmlButton.addEventListener('click', () => openAsset(item.recordingId, 'html'));

    const mdButton = document.createElement('button');
    mdButton.className = 'btn secondary';
    mdButton.type = 'button';
    mdButton.textContent = 'MD';
    mdButton.disabled = !item.markdownAvailable;
    mdButton.addEventListener('click', () => openAsset(item.recordingId, 'md'));

    actionsCell.append(htmlButton, document.createTextNode(' '), mdButton);
    row.append(fileCell, statusCell, stageCell, warningCell, actionsCell);
    refs.conspectsBody.appendChild(row);
  }
}

function renderUsers(users) {
  refs.usersBody.textContent = '';
  if (!Array.isArray(users) || users.length === 0) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 3;
    cell.textContent = 'Пользователей пока нет.';
    row.appendChild(cell);
    refs.usersBody.appendChild(row);
    return;
  }

  for (const user of users) {
    const row = document.createElement('tr');
    const emailCell = document.createElement('td');
    emailCell.textContent = user.email;
    const roleCell = document.createElement('td');
    roleCell.textContent = user.role;
    const createdCell = document.createElement('td');
    createdCell.textContent = formatDate(user.createdAt);
    row.append(emailCell, roleCell, createdCell);
    refs.usersBody.appendChild(row);
  }
}

async function openAsset(recordingId, kind) {
  try {
    setStatus(refs.appStatus, `Открываю ${kind.toUpperCase()} для ${recordingId}...`);
    const blob = await apiRequest(`/api/conspects/${encodeURIComponent(recordingId)}/${kind}`, {
      responseType: 'blob'
    });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener,noreferrer');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    setStatus(refs.appStatus, `Открыт ${kind.toUpperCase()} для ${recordingId}.`);
  } catch (error) {
    setStatus(refs.appStatus, `Ошибка открытия ${kind.toUpperCase()}: ${error.message}`, true);
  }
}

async function loadHealth() {
  try {
    const health = await apiRequest('/api/health', { auth: false });
    state.health = health;
  } catch {
    state.health = null;
  }
}

function updateUserLine() {
  const parts = [`${state.user?.email || '-'}`, `role=${state.user?.role || '-'}`];
  if (state.health) {
    parts.push(`platform=${state.health.platform}`);
    parts.push(`notion=${state.health.notionMode}`);
  }
  refs.userLine.textContent = parts.join(' | ');
}

async function loadConspects() {
  const payload = await apiRequest('/api/conspects');
  const items = Array.isArray(payload?.items) ? payload.items : [];
  state.conspects = items;
  renderConspects(items);
  setStatus(refs.appStatus, `Загружено задач: ${items.length}`);
}

async function loadUsersIfAdmin() {
  if (state.user?.role !== 'admin') {
    renderUsers([]);
    return;
  }
  const payload = await apiRequest('/api/admin/users');
  renderUsers(payload?.users || []);
}

async function enterApp() {
  showAppScreen();
  updateUserLine();
  setStatus(refs.appStatus, 'Загрузка списка конспектов...');
  try {
    await Promise.all([loadConspects(), loadUsersIfAdmin()]);
  } catch (error) {
    if (ensureAuthError(error)) {
      handleLogout(true);
      return;
    }
    setStatus(refs.appStatus, `Ошибка загрузки: ${error.message}`, true);
  }
}

async function bootstrapSession() {
  if (!state.token) {
    showAuthScreen();
    setStatus(refs.authStatus, 'Ожидание входа');
    return;
  }

  try {
    const payload = await apiRequest('/api/auth/me');
    state.user = payload?.user || null;
    setStatus(refs.authStatus, 'Сессия восстановлена');
    await enterApp();
  } catch (error) {
    saveToken('');
    state.user = null;
    showAuthScreen();
    setStatus(refs.authStatus, `Сессия истекла: ${error.message}`, true);
  }
}

async function handleAuth(type, email, password) {
  const endpoint = type === 'register' ? '/api/auth/register' : '/api/auth/login';
  const payload = await apiRequest(endpoint, {
    method: 'POST',
    body: { email, password },
    auth: false
  });
  saveToken(payload?.token || '');
  state.user = payload?.user || null;
}

async function handleLogout(silent = false) {
  try {
    if (state.token) {
      await apiRequest('/api/auth/logout', { method: 'POST' });
    }
  } catch {
    // Intentionally ignored: local logout still works.
  } finally {
    saveToken('');
    state.user = null;
    showAuthScreen();
    if (!silent) {
      setStatus(refs.authStatus, 'Вы вышли из системы');
    }
  }
}

refs.tabLogin.addEventListener('click', () => setLoginTab(true));
refs.tabRegister.addEventListener('click', () => setLoginTab(false));

refs.loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setStatus(refs.authStatus, 'Вход...');
  try {
    await handleAuth('login', refs.loginEmail.value.trim(), refs.loginPassword.value);
    refs.loginPassword.value = '';
    await enterApp();
  } catch (error) {
    setStatus(refs.authStatus, `Ошибка входа: ${error.message}`, true);
  }
});

refs.registerForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setStatus(refs.authStatus, 'Регистрация...');
  try {
    await handleAuth('register', refs.registerEmail.value.trim(), refs.registerPassword.value);
    refs.registerPassword.value = '';
    await enterApp();
  } catch (error) {
    setStatus(refs.authStatus, `Ошибка регистрации: ${error.message}`, true);
  }
});

refs.refreshBtn.addEventListener('click', async () => {
  setStatus(refs.appStatus, 'Обновляю...');
  try {
    await loadConspects();
    if (state.user?.role === 'admin') {
      await loadUsersIfAdmin();
    }
  } catch (error) {
    if (ensureAuthError(error)) {
      await handleLogout(true);
      return;
    }
    setStatus(refs.appStatus, `Ошибка обновления: ${error.message}`, true);
  }
});

refs.logoutBtn.addEventListener('click', async () => {
  await handleLogout(false);
});

refs.notionForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const recordingId = refs.notionRecordingId.value.trim();
  const pageTitle = refs.notionPageTitle.value.trim();
  if (!recordingId || !pageTitle) {
    setStatus(refs.adminStatus, 'Нужно заполнить recordingId и название подстраницы.', true);
    return;
  }

  setStatus(refs.adminStatus, `Writeback ${recordingId} -> ${pageTitle}...`);
  try {
    const result = await apiRequest('/api/admin/notion-writeback', {
      method: 'POST',
      body: { recordingId, pageTitle }
    });
    const target = result?.targetPageId ? `target=${result.targetPageId}` : 'target=unknown';
    setStatus(refs.adminStatus, `Writeback выполнен: ${target}`);
    await loadConspects();
  } catch (error) {
    const suggestions = Array.isArray(error?.details?.suggestions) ? error.details.suggestions : [];
    if (suggestions.length > 0) {
      setStatus(
        refs.adminStatus,
        `Ошибка writeback: ${error.message}. Подсказки: ${suggestions.slice(0, 6).join(', ')}`,
        true
      );
      return;
    }
    setStatus(refs.adminStatus, `Ошибка writeback: ${error.message}`, true);
  }
});

async function init() {
  await loadHealth();
  setLoginTab(true);
  await bootstrapSession();
}

init().catch((error) => {
  showAuthScreen();
  setStatus(refs.authStatus, `Ошибка инициализации: ${error.message}`, true);
});
