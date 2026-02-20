const state = {
  token: localStorage.getItem('conspector_web_token') || '',
  user: null,
  conspects: [],
  subjects: [],
  health: null,
  uploading: false,
  pollingTimers: []
};

const refs = {
  authCard: document.getElementById('auth-card'),
  welcomeCard: document.getElementById('welcome-card'),
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
  adminStatus: document.getElementById('admin-status'),
  // Upload
  uploadZone: document.getElementById('upload-zone'),
  uploadInput: document.getElementById('upload-input'),
  uploadProgress: document.getElementById('upload-progress'),
  uploadFileName: document.getElementById('upload-file-name'),
  uploadPercent: document.getElementById('upload-percent'),
  uploadProgressBar: document.getElementById('upload-progress-bar'),
  uploadStatusText: document.getElementById('upload-status-text'),
  // Subject selector
  subjectSelect: document.getElementById('subject-select'),
  createSubjectBtn: document.getElementById('create-subject-btn'),
  adminUploadPanel: document.getElementById('admin-upload-panel'),
  appTitle: document.getElementById('app-title'),
  // Library
  libraryCard: document.getElementById('library-card'),
  libraryBtn: document.getElementById('library-btn'),
  libraryBack: document.getElementById('library-back'),
  librarySelect: document.getElementById('library-select'),
  libraryDownloadMd: document.getElementById('library-download-md'),
  libraryNotionBtn: document.getElementById('library-notion-btn'),
  libraryContent: document.getElementById('library-content')
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
  refs.welcomeCard.classList.add('hidden');
  refs.authCard.classList.remove('hidden');
  refs.appCard.classList.add('hidden');
  refs.adminCard.classList.add('hidden');
}

function showAppScreen() {
  refs.welcomeCard.classList.add('hidden');
  refs.authCard.classList.add('hidden');
  refs.appCard.classList.remove('hidden');
  refs.libraryCard.classList.add('hidden');
  const isAdmin = state.user?.role === 'admin';
  if (isAdmin) {
    refs.adminCard.classList.remove('hidden');
    refs.adminUploadPanel.classList.remove('hidden');
    refs.appTitle.textContent = 'Загрузка и обработка';
  } else {
    refs.adminCard.classList.add('hidden');
    refs.adminUploadPanel.classList.add('hidden');
    refs.appTitle.textContent = 'Конспекты';
  }
}

function showLibraryScreen() {
  refs.appCard.classList.add('hidden');
  refs.adminCard.classList.add('hidden');
  refs.libraryCard.classList.remove('hidden');
  populateLibraryDropdown();
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

function stripFileExtension(fileName) {
  const value = String(fileName || '').trim();
  if (!value) {
    return '';
  }
  return value.replace(/\.[^./\\]+$/, '').trim();
}

function deriveNotionPageTitle(item) {
  const subjectName = String(item?.subjectName || '').trim();
  if (subjectName) {
    return subjectName;
  }
  const fromFile = stripFileExtension(item?.fileName || '');
  if (fromFile) {
    return fromFile;
  }
  return String(item?.recordingId || '').trim();
}

function extractSuggestionTitles(errorDetails) {
  if (!errorDetails || typeof errorDetails !== 'object') {
    return [];
  }
  const source = Array.isArray(errorDetails.suggestions) ? errorDetails.suggestions : [];
  return source
    .map((item) => {
      if (typeof item === 'string') {
        return item.trim();
      }
      if (item && typeof item === 'object' && typeof item.title === 'string') {
        return item.title.trim();
      }
      return '';
    })
    .filter(Boolean)
    .slice(0, 8);
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
    cell.textContent = 'Пока нет результатов. Загрузите аудио выше ↑';
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
    const subjectChunk = item.subjectName ? ` · ${item.subjectName}` : '';
    meta.textContent = `${item.recordingId}${subjectChunk} · ${formatDuration(item.durationSec)} · ${formatDate(item.createdAt)}`;
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
    const maxLen = 120;
    if (warningText.length > maxLen) {
      warningLine.textContent = warningText.slice(0, maxLen) + '...';
      warningLine.title = warningText;
      warningLine.style.cursor = 'help';
    } else {
      warningLine.textContent = warningText;
    }
    warningCell.appendChild(warningLine);

    const actionsCell = document.createElement('td');
    actionsCell.setAttribute('data-label', 'Действия');

    if (item.htmlAvailable) {
      const viewBtn = document.createElement('button');
      viewBtn.className = 'btn secondary';
      viewBtn.style.fontSize = '12px';
      viewBtn.style.padding = '6px 10px';
      viewBtn.textContent = 'Просмотр';
      viewBtn.addEventListener('click', () => {
        openConspectInNewTab(item.recordingId);
      });
      actionsCell.appendChild(viewBtn);

      // Notion writeback button (admin only)
      if (state.user?.role === 'admin' && state.health?.notionMode === 'real') {
        const notionBtn = document.createElement('button');
        notionBtn.className = 'btn ghost';
        notionBtn.style.fontSize = '12px';
        notionBtn.style.padding = '6px 10px';
        notionBtn.style.marginLeft = '6px';
        notionBtn.textContent = 'Notion';
        notionBtn.addEventListener('click', () => {
          notionWriteback(item);
        });
        actionsCell.appendChild(notionBtn);
      }
    } else if (statusStr === 'processing' || statusStr === 'running' || statusStr === 'queued') {
      const badge = document.createElement('span');
      badge.className = 'badge processing';
      badge.textContent = 'Обработка...';
      actionsCell.appendChild(badge);
    }

    // Delete button (admin only)
    if (state.user?.role === 'admin') {
      const delBtn = document.createElement('button');
      delBtn.className = 'btn-delete';
      delBtn.style.marginLeft = '6px';
      delBtn.textContent = '🗑';
      delBtn.title = 'Удалить запись';
      delBtn.addEventListener('click', () => {
        deleteConspect(item.recordingId, item.fileName);
      });
      actionsCell.appendChild(delBtn);
    }

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
  if (state.user?.role === 'admin') {
    const parts = [`${state.user?.email || '-'}`, `role=${state.user?.role || '-'}`];
    if (state.health) {
      parts.push(`platform=${state.health.platform}`);
      parts.push(`notion=${state.health.notionMode}`);
    }
    refs.userLine.textContent = parts.join(' | ');
  } else {
    refs.userLine.textContent = state.user?.email || '';
  }
}

async function loadConspects() {
  const payload = await apiRequest('/api/conspects');
  const items = Array.isArray(payload?.items) ? payload.items : [];
  state.conspects = items;
  renderConspects(items);
  setStatus(refs.appStatus, `Загружено задач: ${items.length}`);
}

async function loadSubjects() {
  try {
    const payload = await apiRequest('/api/subjects');
    state.subjects = Array.isArray(payload?.subjects) ? payload.subjects : [];
    populateSubjectDropdown();
  } catch {
    state.subjects = [];
  }
}

function populateSubjectDropdown() {
  const select = refs.subjectSelect;
  const current = select.value;
  select.innerHTML = '<option value="" disabled selected>\u2014 \u0432\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u043f\u0440\u0435\u0434\u043c\u0435\u0442 \u2014</option>';
  for (const subj of state.subjects) {
    const opt = document.createElement('option');
    opt.value = subj.id;
    opt.textContent = `${subj.name}  (${subj.recording_count} аудио)`;
    select.appendChild(opt);
  }
  if (current && state.subjects.some(s => s.id === current)) {
    select.value = current;
  }
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
  setStatus(refs.appStatus, '\u0417\u0430\u0433\u0440\u0443\u0437\u043a\u0430 \u0441\u043f\u0438\u0441\u043a\u0430 \u043a\u043e\u043d\u0441\u043f\u0435\u043a\u0442\u043e\u0432...');
  try {
    await Promise.all([loadConspects(), loadUsersIfAdmin(), loadSubjects()]);
  } catch (error) {
    if (ensureAuthError(error)) {
      handleLogout(true);
      return;
    }
    setStatus(refs.appStatus, `\u041e\u0448\u0438\u0431\u043a\u0430 \u0437\u0430\u0433\u0440\u0443\u0437\u043a\u0438: ${error.message}`, true);
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

document.getElementById('welcome-start-btn').addEventListener('click', () => showAuthScreen());
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

async function notionWriteback(item) {
  const recordingId = String(item?.recordingId || '').trim();
  if (!recordingId) {
    setStatus(refs.appStatus, 'Ошибка writeback: recordingId is empty', true);
    return;
  }

  const pageTitle = deriveNotionPageTitle(item);
  if (!pageTitle) {
    setStatus(refs.appStatus, `Ошибка writeback: не удалось определить название подстраницы для ${recordingId}`, true);
    return;
  }

  const confirmText = `Отправить конспект в Notion?\n\nБудет искаться подстраница: "${pageTitle}"`;
  if (!confirm(confirmText)) return;

  setStatus(refs.appStatus, `Notion writeback: ${recordingId}. Ищем подстраницу "${pageTitle}"...`);
  try {
    const result = await apiRequest('/api/admin/notion-writeback', {
      method: 'POST',
      body: { recordingId, pageTitle }
    });
    const requestedTitle = result?.targetPageTitleRequested || pageTitle;
    const resolvedTitle = result?.targetPageTitleResolved ? `"${result.targetPageTitleResolved}"` : '(n/a)';
    const targetPageId = result?.targetPageId || result?.pageId || '';
    const strategy = result?.targetPageLookupStrategy || '';
    setStatus(
      refs.appStatus,
      `Writeback выполнен. Искомая: "${requestedTitle}". Найдена: ${resolvedTitle}${targetPageId ? ` (id=${targetPageId})` : ''}${strategy ? `, strategy=${strategy}` : ''}`
    );
    await loadConspects();
  } catch (error) {
    const suggestions = extractSuggestionTitles(error?.details);
    if (suggestions.length > 0) {
      setStatus(refs.appStatus, `Ошибка writeback: ${error.message}. Подсказки: ${suggestions.slice(0, 6).join(', ')}`, true);
      return;
    }
    setStatus(refs.appStatus, `Ошибка writeback: ${error.message}`, true);
  }
}

async function deleteConspect(recordingId, fileName) {
  const label = fileName || recordingId;
  if (!confirm(`Удалить "${label}" и все связанные файлы?`)) return;

  setStatus(refs.appStatus, `Удаление ${label}...`);
  try {
    await apiRequest(`/api/conspects/${encodeURIComponent(recordingId)}`, {
      method: 'DELETE'
    });
    setStatus(refs.appStatus, `Удалено: ${label}`);
    await loadConspects();
  } catch (error) {
    setStatus(refs.appStatus, `Ошибка удаления: ${error.message}`, true);
  }
}

async function init() {
  await loadHealth();
  setLoginTab(true);
  await bootstrapSession();
}

init().catch((error) => {
  showAuthScreen();
  setStatus(refs.authStatus, `Ошибка инициализации: ${error.message}`, true);
});

// ─── Upload logic ───

function resetUploadUI() {
  state.uploading = false;
  refs.uploadProgress.classList.add('hidden');
  refs.uploadZone.querySelector('.upload-zone-content').classList.remove('hidden');
  refs.uploadZone.classList.remove('drag-over');
  refs.uploadProgressBar.style.width = '0%';
  refs.uploadPercent.textContent = '0%';
  refs.uploadStatusText.textContent = '';
  refs.uploadInput.value = '';
}

function showUploadProgress(fileName) {
  state.uploading = true;
  refs.uploadZone.querySelector('.upload-zone-content').classList.add('hidden');
  refs.uploadProgress.classList.remove('hidden');
  refs.uploadFileName.textContent = fileName;
  refs.uploadPercent.textContent = '0%';
  refs.uploadProgressBar.style.width = '0%';
  refs.uploadStatusText.textContent = 'Загрузка на сервер...';
}

async function uploadFile(file) {
  if (state.uploading) return;

  showUploadProgress(file.name);

  try {
    // Upload via XHR for progress tracking
    const result = await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/upload');
      xhr.setRequestHeader('Authorization', `Bearer ${state.token}`);

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 100);
          refs.uploadPercent.textContent = `${pct}%`;
          refs.uploadProgressBar.style.width = `${pct}%`;
        }
      });

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText));
          } catch {
            reject(new Error('Невалидный ответ сервера'));
          }
        } else {
          try {
            const err = JSON.parse(xhr.responseText);
            reject(new Error(err?.error?.message || `HTTP ${xhr.status}`));
          } catch {
            reject(new Error(`HTTP ${xhr.status}`));
          }
        }
      });

      xhr.addEventListener('error', () => reject(new Error('Ошибка сети')));
      xhr.addEventListener('abort', () => reject(new Error('Загрузка отменена')));

      const formData = new FormData();
      formData.append('audio', file);
      // Attach selected subject
      const subjectId = refs.subjectSelect?.value || '';
      if (subjectId) {
        formData.append('subjectId', subjectId);
      }
      // Attach selected LLM model
      const llmModelSelect = document.getElementById('llm-model-select');
      const llmModel = llmModelSelect?.value || 'auto';
      formData.append('llmModel', llmModel);
      xhr.send(formData);
    });

    refs.uploadPercent.textContent = '100%';
    refs.uploadProgressBar.style.width = '100%';
    refs.uploadStatusText.textContent = `Файл загружен! Обработка: ${result.recordingId}`;
    setStatus(refs.appStatus, `Загружено: ${result.fileName}. Обработка запущена.`);

    // Start polling for job status
    if (result.recordingId) {
      pollJobStatus(result.recordingId);
    }

    // Refresh list after short delay
    setTimeout(async () => {
      await loadConspects();
      resetUploadUI();
    }, 2000);

  } catch (error) {
    refs.uploadStatusText.textContent = `Ошибка: ${error.message}`;
    refs.uploadStatusText.classList.add('error');
    setStatus(refs.appStatus, `Ошибка загрузки: ${error.message}`, true);
    setTimeout(() => resetUploadUI(), 4000);
  }
}

function pollJobStatus(recordingId) {
  let attempts = 0;
  const maxAttempts = 600; // ~10 minutes at 1s intervals

  const timerId = setInterval(async () => {
    attempts++;
    if (attempts > maxAttempts) {
      clearInterval(timerId);
      return;
    }

    try {
      const data = await apiRequest(`/api/jobs/${encodeURIComponent(recordingId)}/status`);
      if (!data?.ok) return;

      const job = data.job;
      if (!job) return;

      if (job.status === 'done') {
        clearInterval(timerId);
        setStatus(refs.appStatus, `Обработка завершена: ${recordingId}`);
        await loadConspects();
      } else if (job.status === 'failed') {
        clearInterval(timerId);
        setStatus(refs.appStatus, `Обработка не удалась: ${job.errorMessage || 'unknown'}`, true);
        await loadConspects();
      } else {
        // Update status with current stage
        setStatus(refs.appStatus, `Обработка ${recordingId}: ${job.stage || '...'} (${job.status})`);
      }
    } catch {
      // Silently skip polling errors
    }
  }, 2000);

  state.pollingTimers.push(timerId);
}

// ─── Drag-and-drop handlers ───

refs.uploadZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.stopPropagation();
  refs.uploadZone.classList.add('drag-over');
});

refs.uploadZone.addEventListener('dragleave', (e) => {
  e.preventDefault();
  e.stopPropagation();
  refs.uploadZone.classList.remove('drag-over');
});

refs.uploadZone.addEventListener('drop', (e) => {
  e.preventDefault();
  e.stopPropagation();
  refs.uploadZone.classList.remove('drag-over');
  const file = e.dataTransfer?.files?.[0];
  if (file) {
    uploadFile(file);
  }
});

refs.uploadInput.addEventListener('change', () => {
  const file = refs.uploadInput.files?.[0];
  if (file) {
    uploadFile(file);
  }
});

// ─── Viewer logic ───

async function openConspectInNewTab(recordingId) {
  try {
    setStatus(refs.appStatus, `Открываю конспект ${recordingId}...`);
    const html = await apiRequest(`/api/conspects/${encodeURIComponent(recordingId)}/html`, {
      responseType: 'text'
    });
    const blob = new Blob([html], { type: 'text/html; charset=utf-8' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 120_000);
    setStatus(refs.appStatus, `Конспект открыт в новой вкладке`);
  } catch (error) {
    setStatus(refs.appStatus, `Ошибка загрузки конспекта: ${error.message}`, true);
  }
}

// ─── Subject management ───

refs.createSubjectBtn.addEventListener('click', async () => {
  const name = prompt('Название нового предмета:');
  if (!name?.trim()) return;
  try {
    const payload = await apiRequest('/api/subjects', {
      method: 'POST',
      body: { name: name.trim() }
    });
    await loadSubjects();
    // Auto-select the newly created subject
    if (payload?.subject?.id) {
      refs.subjectSelect.value = payload.subject.id;
    }
    setStatus(refs.appStatus, `Предмет "${name.trim()}" создан`);
    // Show dropzone since subject is now selected
    refs.uploadZone.classList.remove('hidden');
  } catch (error) {
    setStatus(refs.appStatus, `Ошибка: ${error.message}`, true);
  }
});

// Show dropzone when subject is selected
refs.subjectSelect.addEventListener('change', () => {
  if (refs.subjectSelect.value) {
    refs.uploadZone.classList.remove('hidden');
  }
});

// ─── Library tab (by subjects) ───

async function populateLibraryDropdown() {
  const select = refs.librarySelect;
  const current = select.value;
  select.innerHTML = '<option value="" disabled selected>\u2014 \u0432\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u043f\u0440\u0435\u0434\u043c\u0435\u0442 \u2014</option>';

  try {
    const payload = await apiRequest('/api/subjects');
    const subjects = Array.isArray(payload?.subjects) ? payload.subjects : [];

    if (subjects.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.disabled = true;
      opt.textContent = 'Нет предметов';
      select.appendChild(opt);
      refs.libraryDownloadMd.disabled = true;
      refs.libraryNotionBtn.disabled = true;
      return;
    }

    for (const subj of subjects) {
      const opt = document.createElement('option');
      opt.value = subj.id;
      opt.textContent = `${subj.name}  (${subj.recording_count} аудио)`;
      select.appendChild(opt);
    }

    if (current && subjects.some(s => s.id === current)) {
      select.value = current;
    }
  } catch (error) {
    refs.libraryContent.textContent = `Ошибка загрузки предметов: ${error.message}`;
  }
}

async function loadSubjectConspect(subjectId) {
  refs.libraryContent.textContent = 'Загрузка...';
  refs.libraryDownloadMd.disabled = false;
  refs.libraryNotionBtn.disabled = false;
  state.librarySubjectId = subjectId;

  // Try HTML first, fallback to MD
  try {
    const html = await apiRequest(`/api/subjects/${encodeURIComponent(subjectId)}/html`, {
      responseType: 'text'
    });
    refs.libraryContent.textContent = '';
    // Show a button to open full-page HTML in new tab
    const openBtn = document.createElement('button');
    openBtn.className = 'btn primary';
    openBtn.textContent = '📖 Открыть конспект на полную страницу';
    openBtn.style.margin = '20px auto';
    openBtn.style.display = 'block';
    openBtn.style.fontSize = '16px';
    openBtn.style.padding = '14px 28px';
    const htmlBlob = new Blob([html], { type: 'text/html; charset=utf-8' });
    const htmlUrl = URL.createObjectURL(htmlBlob);
    openBtn.addEventListener('click', () => {
      window.open(htmlUrl, '_blank');
    });
    refs.libraryContent.appendChild(openBtn);
    // Also auto-open on first load
    window.open(htmlUrl, '_blank');
    return;
  } catch (_htmlError) {
    // HTML not available — try MD fallback
  }

  try {
    const mdText = await apiRequest(`/api/subjects/${encodeURIComponent(subjectId)}/md`, {
      responseType: 'text'
    });
    refs.libraryContent.textContent = '';
    const pre = document.createElement('pre');
    pre.className = 'library-md-fallback';
    pre.textContent = mdText;
    refs.libraryContent.appendChild(pre);
  } catch (_mdError) {
    refs.libraryContent.textContent = 'Конспект еще не сгенерирован для этого предмета. Загрузите аудио лекции и дождитесь обработки.';
    refs.libraryDownloadMd.disabled = true;
    refs.libraryNotionBtn.disabled = true;
  }
}

refs.libraryBtn.addEventListener('click', () => {
  showLibraryScreen();
});

refs.libraryBack.addEventListener('click', () => {
  refs.libraryCard.classList.add('hidden');
  state.librarySubjectId = null;
  showAppScreen();
});

refs.librarySelect.addEventListener('change', () => {
  const subjectId = refs.librarySelect.value;
  if (subjectId) {
    loadSubjectConspect(subjectId);
  }
});

refs.libraryDownloadMd.addEventListener('click', async () => {
  const subjectId = state.librarySubjectId;
  if (!subjectId) return;
  try {
    const blob = await apiRequest(`/api/subjects/${encodeURIComponent(subjectId)}/md`, {
      responseType: 'blob'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `subject_${subjectId}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } catch (error) {
    refs.libraryContent.textContent = `Ошибка скачивания: ${error.message}`;
  }
});

refs.libraryNotionBtn.addEventListener('click', async () => {
  const subjectId = state.librarySubjectId;
  if (!subjectId) return;
  const selectedOption = refs.librarySelect?.options?.[refs.librarySelect.selectedIndex];
  const subjectLabelRaw = String(selectedOption?.textContent || '').trim();
  const subjectLabel = subjectLabelRaw.replace(/\s+\(\d+\s+аудио\)\s*$/, '').trim() || subjectLabelRaw || subjectId;
  if (!confirm(`Отправить конспект в Notion?\n\nБудет искаться подстраница: "${subjectLabel}"`)) return;
  try {
    refs.libraryNotionBtn.disabled = true;
    refs.libraryNotionBtn.textContent = '↑ Отправка...';
    const result = await apiRequest(`/api/subjects/${encodeURIComponent(subjectId)}/notion`, {
      method: 'POST'
    });
    const requestedTitle = result?.targetPageTitleRequested || subjectLabel;
    const resolvedTitle = result?.targetPageTitleResolved ? `"${result.targetPageTitleResolved}"` : '(n/a)';
    refs.libraryNotionBtn.textContent = '\u2714 Отправлено!';
    setStatus(
      refs.appStatus,
      `Notion: искали "${requestedTitle}", нашли ${resolvedTitle}${result?.targetPageId || result?.pageId ? ` (id=${result?.targetPageId || result?.pageId})` : ''}`
    );
    setTimeout(() => {
      refs.libraryNotionBtn.textContent = '\u2191 Notion';
      refs.libraryNotionBtn.disabled = false;
    }, 3000);
  } catch (error) {
    refs.libraryNotionBtn.textContent = '\u2191 Notion';
    refs.libraryNotionBtn.disabled = false;
    refs.libraryContent.textContent = `Ошибка Notion: ${error.message}`;
  }
});


// ─── Git integration (admin) ───

const syncToRepoBtn = document.getElementById('sync-to-repo-btn');
const applyFromRepoBtn = document.getElementById('apply-from-repo-btn');
const gitStatus = document.getElementById('git-status');

if (syncToRepoBtn) {
  syncToRepoBtn.addEventListener('click', async () => {
    if (!confirm('Скопировать конспекты в conspects/ и закоммитить?')) return;
    const msg = prompt('Commit message (Enter для авто):', '');
    try {
      syncToRepoBtn.disabled = true;
      syncToRepoBtn.textContent = '⬆ Синхронизация...';
      setStatus(gitStatus, 'Синхронизация...');
      const body = msg?.trim() ? { message: msg.trim() } : {};
      const result = await apiRequest('/api/admin/sync-conspects-to-repo', {
        method: 'POST',
        body: body
      });
      const names = (result.synced || []).map(s => s.name).join(', ');
      setStatus(gitStatus, `✔ Синхронизировано: ${names}`);
    } catch (error) {
      setStatus(gitStatus, `Ошибка: ${error.message}`, true);
    } finally {
      syncToRepoBtn.disabled = false;
      syncToRepoBtn.textContent = '⬆ Sync to Git';
    }
  });
}

if (applyFromRepoBtn) {
  applyFromRepoBtn.addEventListener('click', async () => {
    if (!confirm('Применить конспекты из conspects/ обратно в систему?')) return;
    try {
      applyFromRepoBtn.disabled = true;
      applyFromRepoBtn.textContent = '⬇ Применение...';
      setStatus(gitStatus, 'Применение из репозитория...');
      const result = await apiRequest('/api/admin/apply-from-repo', {
        method: 'POST'
      });
      const names = (result.applied || []).map(s => s.name).join(', ');
      setStatus(gitStatus, names ? `✔ Применено: ${names}` : 'Нет файлов для применения');
    } catch (error) {
      setStatus(gitStatus, `Ошибка: ${error.message}`, true);
    } finally {
      applyFromRepoBtn.disabled = false;
      applyFromRepoBtn.textContent = '⬇ Apply from Repo';
    }
  });
}
