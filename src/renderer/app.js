const api = window.conspectorApi;

const startRecordingBtn = document.getElementById('start-recording-btn');
const stopRecordingBtn = document.getElementById('stop-recording-btn');
const addAudioBtn = document.getElementById('add-audio-btn');
const openDataBtn = document.getElementById('open-data-btn');
const openHtmlBtn = document.getElementById('open-html-btn');
const openMdBtn = document.getElementById('open-md-btn');
const retryJobBtn = document.getElementById('retry-job-btn');
const writebackNotionBtn = document.getElementById('writeback-notion-btn');
const codexEffortSelect = document.getElementById('codex-effort-select');
const codexSettingsStatus = document.getElementById('codex-settings-status');
const recorderStatus = document.getElementById('recorder-status');
const importStatus = document.getElementById('import-status');
const importList = document.getElementById('import-list');
const queueInfo = document.getElementById('queue-info');
const selectedJobInfo = document.getElementById('selected-job-info');
const jobsBody = document.getElementById('jobs-body');

const stageLabels = {
  normalize_audio: 'Нормализация',
  stt_diarization: 'STT + диаризация',
  codex_structure: 'Структурирование',
  merge: 'Merge',
  render_html: 'HTML',
  notion_writeback: 'Notion',
  done: 'Завершено'
};

const sourceLabels = {
  microphone: 'microphone',
  imported_file: 'imported_file'
};

/** @type {Array<any>} */
let jobs = [];
let selectedJobId = null;

setRecorderState({ isRecording: false });
updateActionButtons();

function escapeHtml(input) {
  return String(input ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatDuration(sec) {
  if (!Number.isFinite(sec) || sec <= 0) {
    return '0:00';
  }

  const total = Math.floor(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;

  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

function setImportStatus(text, isError = false) {
  importStatus.textContent = text;
  importStatus.classList.toggle('error', isError);
}

function setCodexStatus(text, isError = false) {
  codexSettingsStatus.textContent = text;
  codexSettingsStatus.classList.toggle('error', isError);
}

function setRecorderState(payload) {
  const isRecording = Boolean(payload?.isRecording);
  startRecordingBtn.disabled = isRecording;
  stopRecordingBtn.disabled = !isRecording;

  if (!isRecording) {
    recorderStatus.textContent = 'Микрофон: не записывает';
    return;
  }

  const startedAt = payload?.startedAt ? new Date(payload.startedAt).toLocaleString() : 'unknown';
  recorderStatus.textContent = `Микрофон: запись идёт (с ${startedAt})`;
}

function appendImportItem(payload) {
  const item = document.createElement('article');
  item.className = 'item';
  item.dataset.recordingId = payload.recordingId;
  item.innerHTML = `
    <h3>${escapeHtml(payload.originalFilename)}</h3>
    <p>ID: ${escapeHtml(payload.recordingId)}</p>
    <p>Длительность: ${escapeHtml(formatDuration(payload.durationSec))}</p>
    <p class="conversion-status">Статус конвертации: ${escapeHtml(payload.normalizationStatus)}</p>
    ${payload.warning ? `<p>⚠ ${escapeHtml(payload.warning)}</p>` : ''}
  `;

  importList.prepend(item);
}

function ensureSelectedJob(rows) {
  if (!rows || rows.length === 0) {
    selectedJobId = null;
    return;
  }

  if (selectedJobId && rows.some((row) => row.id === selectedJobId)) {
    return;
  }

  selectedJobId = rows[0].id;
}

function getSelectedJob() {
  return jobs.find((row) => row.id === selectedJobId) || null;
}

function setSelectedJobInfo() {
  const selected = getSelectedJob();
  if (!selected) {
    selectedJobInfo.textContent = 'Задача не выбрана';
    return;
  }

  const warningOrError =
    selected.error_message
      ? `${selected.error_code || 'ERROR'}: ${selected.error_message}`
      : selected.warning || 'без warning';

  selectedJobInfo.textContent =
    `Выбрано: ${selected.id} | status=${selected.status} | stage=${selected.stage} | ${warningOrError}`;
}

function updateActionButtons() {
  const selected = getSelectedJob();
  const hasSelection = Boolean(selected);
  const canOpenResults = hasSelection && selected.status === 'done';

  openHtmlBtn.disabled = !canOpenResults;
  openMdBtn.disabled = !canOpenResults;
  writebackNotionBtn.disabled = !canOpenResults;
  retryJobBtn.disabled = !hasSelection;
}

function renderJobs(rows) {
  jobs = rows || [];
  ensureSelectedJob(jobs);

  jobsBody.innerHTML = '';

  if (jobs.length === 0) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="7" class="muted">Пока нет задач</td>`;
    jobsBody.append(tr);
    setSelectedJobInfo();
    updateActionButtons();
    return;
  }

  for (const row of jobs) {
    const tr = document.createElement('tr');
    tr.className = row.id === selectedJobId ? 'selected-row' : '';
    tr.dataset.jobId = row.id;

    const issueText = row.error_message
      ? `${row.error_code || 'ERROR'}: ${row.error_message}`
      : row.warning || '—';

    tr.innerHTML = `
      <td><input type="radio" name="selected-job" ${row.id === selectedJobId ? 'checked' : ''} /></td>
      <td>${escapeHtml(row.original_file_name ?? row.recording_id)}</td>
      <td>${escapeHtml(sourceLabels[row.source_type] ?? row.source_type)}</td>
      <td>${escapeHtml(stageLabels[row.stage] ?? row.stage)}</td>
      <td>${escapeHtml(row.status)}</td>
      <td>${escapeHtml(formatDuration(row.duration_sec))}</td>
      <td>${escapeHtml(issueText)}</td>
    `;

    tr.addEventListener('click', () => {
      selectedJobId = row.id;
      renderJobs(jobs);
    });

    jobsBody.append(tr);
  }

  setSelectedJobInfo();
  updateActionButtons();
}

async function refreshJobs() {
  const rows = await api.listJobs();
  renderJobs(rows);
}

async function loadCodexSettings() {
  const settings = await api.getCodexSettings();
  const effort = ['low', 'medium', 'high'].includes(settings?.reasoningEffort)
    ? settings.reasoningEffort
    : 'medium';
  codexEffortSelect.value = effort;
  setCodexStatus(`Codex профиль: ${effort}`);
}

async function withStatus(statusText, fn) {
  try {
    setImportStatus(statusText);
    await fn();
  } catch (error) {
    setImportStatus(`Ошибка: ${error.message}`, true);
  }
}

startRecordingBtn.addEventListener('click', () => {
  withStatus('Запускаем запись с микрофона...', async () => {
    const state = await api.startRecording();
    setRecorderState(state);
    setImportStatus('Запись запущена');
  });
});

stopRecordingBtn.addEventListener('click', () => {
  withStatus('Останавливаем запись и отправляем в очередь...', async () => {
    const imported = await api.stopRecording();
    setImportStatus(`Запись сохранена: ${imported.originalFilename}`);
    await refreshJobs();
  });
});

addAudioBtn.addEventListener('click', () => {
  withStatus('Открываем выбор файла...', async () => {
    const picked = await api.pickAudio();
    if (!picked || picked.canceled || !picked.path) {
      setImportStatus('Импорт отменён');
      return;
    }

    const imported = await api.importAudio(picked.path);
    setImportStatus(`Файл ${imported.originalFilename} добавлен в очередь`);
    await refreshJobs();
  });
});

openDataBtn.addEventListener('click', () => {
  withStatus('Открываем папку данных...', async () => {
    await api.openDataFolder();
    setImportStatus('Папка данных открыта');
  });
});

openHtmlBtn.addEventListener('click', () => {
  withStatus('Открываем HTML...', async () => {
    const selected = getSelectedJob();
    if (!selected) {
      throw new Error('Сначала выберите задачу');
    }
    await api.openResult(selected.recording_id, 'html');
    setImportStatus('HTML открыт');
  });
});

openMdBtn.addEventListener('click', () => {
  withStatus('Открываем merged.md...', async () => {
    const selected = getSelectedJob();
    if (!selected) {
      throw new Error('Сначала выберите задачу');
    }
    await api.openResult(selected.recording_id, 'markdown');
    setImportStatus('merged.md открыт');
  });
});

retryJobBtn.addEventListener('click', () => {
  withStatus('Повторяем задачу...', async () => {
    const selected = getSelectedJob();
    if (!selected) {
      throw new Error('Сначала выберите задачу');
    }
    await api.retryJob(selected.id);
    setImportStatus(`Повтор запущен для ${selected.id}`);
    await refreshJobs();
  });
});

writebackNotionBtn.addEventListener('click', () => {
  withStatus('Отправляем merged в Notion...', async () => {
    const selected = getSelectedJob();
    if (!selected) {
      throw new Error('Сначала выберите задачу');
    }

    const pageTitle = window.prompt(
      'Введите точное название страницы Notion (оставьте пустым для значения из .env):',
      ''
    );

    if (pageTitle === null) {
      setImportStatus('Отправка в Notion отменена');
      return;
    }

    const result = await api.writebackNotion(selected.recording_id, pageTitle || '');
    if (result?.warning) {
      setImportStatus(`Notion: ${result.warning}`);
      return;
    }

    setImportStatus(`Notion: записано ${result?.blocksWritten ?? 0} блоков`);
  });
});

codexEffortSelect.addEventListener('change', () => {
  const effort = codexEffortSelect.value;
  setCodexStatus(`Обновляем профиль Codex: ${effort}...`);
  api.updateCodexSettings({ reasoningEffort: effort })
    .then((settings) => {
      setCodexStatus(`Codex профиль: ${settings.reasoningEffort}`);
      setImportStatus(`Профиль Codex обновлён: ${settings.reasoningEffort}`);
    })
    .catch((error) => {
      setCodexStatus(`Ошибка профиля Codex: ${error.message}`, true);
    });
});

if (!api) {
  setImportStatus('Ошибка preload: conspectorApi недоступен', true);
  setRecorderState({ isRecording: false });
  [
    startRecordingBtn,
    stopRecordingBtn,
    addAudioBtn,
    openDataBtn,
    openHtmlBtn,
    openMdBtn,
    retryJobBtn,
    writebackNotionBtn,
    codexEffortSelect
  ].forEach((btn) => {
    btn.disabled = true;
  });
  updateActionButtons();
} else {
  api.onAudioImported((payload) => {
    appendImportItem(payload);
    refreshJobs().catch((error) => {
      setImportStatus(`Не удалось обновить задачи: ${error.message}`, true);
    });
  });

  api.onAudioImportFailed((payload) => {
    setImportStatus(`Импорт не выполнен: ${payload.code} — ${payload.message}`, true);
  });

  api.onQueueUpdated((payload) => {
    queueInfo.textContent = `Очередь: pending=${payload.pending}, running=${payload.running ? 'yes' : 'no'}`;
  });

  api.onJobUpdated((payload) => {
    const card = importList.querySelector(`[data-recording-id="${payload.recordingId}"]`);
    if (card) {
      const statusLine = card.querySelector('.conversion-status');
      if (statusLine) {
        statusLine.textContent = `Статус конвертации: ${payload.stage}/${payload.status}`;
      }
    }

    refreshJobs().catch((error) => {
      setImportStatus(`Не удалось обновить задачи: ${error.message}`, true);
    });
  });

  api.onRecorderState((payload) => {
    setRecorderState(payload);
  });

  loadCodexSettings().catch((error) => {
    setCodexStatus(`Не удалось загрузить профиль Codex: ${error.message}`, true);
  });

  refreshJobs().catch((error) => {
    setImportStatus(`Не удалось загрузить список задач: ${error.message}`, true);
  });
}
