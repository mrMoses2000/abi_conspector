const api = window.conspectorApi;

const startRecordingBtn = document.getElementById('start-recording-btn');
const stopRecordingBtn = document.getElementById('stop-recording-btn');
const addAudioBtn = document.getElementById('add-audio-btn');
const openDataBtn = document.getElementById('open-data-btn');
const openHtmlBtn = document.getElementById('open-html-btn');
const openMdBtn = document.getElementById('open-md-btn');
const retryJobBtn = document.getElementById('retry-job-btn');
const writebackNotionBtn = document.getElementById('writeback-notion-btn');
const cleanupFailedBtn = document.getElementById('cleanup-failed-btn');
const notionPageTitleInput = document.getElementById('notion-page-title-input');
const codexEffortSelect = document.getElementById('codex-effort-select');
const codexSettingsStatus = document.getElementById('codex-settings-status');
const recorderStatus = document.getElementById('recorder-status');
const importStatus = document.getElementById('import-status');
const importList = document.getElementById('import-list');
const queueInfo = document.getElementById('queue-info');
const selectedJobInfo = document.getElementById('selected-job-info');
const jobProgressStatus = document.getElementById('job-progress-status');
const actionHint = document.getElementById('action-hint');
const jobProgressBar = document.getElementById('job-progress-bar');
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

const stageProgress = {
  normalize_audio: 12,
  stt_diarization: 45,
  codex_structure: 68,
  merge: 82,
  render_html: 93,
  notion_writeback: 97,
  done: 100
};

const runningStageRanges = {
  normalize_audio: [8, 20],
  stt_diarization: [20, 60],
  codex_structure: [60, 75],
  merge: [75, 88],
  render_html: [88, 96],
  notion_writeback: [96, 99]
};

/** @type {Array<any>} */
let jobs = [];
let selectedJobId = null;
let jobsPollTimer = null;
const liveProgressByJob = new Map();

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

function formatElapsed(isoString) {
  if (!isoString) {
    return '0:00';
  }

  const start = new Date(isoString).getTime();
  if (!Number.isFinite(start)) {
    return '0:00';
  }

  const elapsedSec = Math.max(0, Math.floor((Date.now() - start) / 1000));
  return formatDuration(elapsedSec);
}

function elapsedSeconds(isoString) {
  if (!isoString) {
    return 0;
  }
  const start = new Date(isoString).getTime();
  if (!Number.isFinite(start)) {
    return 0;
  }
  return Math.max(0, Math.floor((Date.now() - start) / 1000));
}

function estimateRunningPercent(selected) {
  const [minP, maxP] = runningStageRanges[selected.stage] || [10, 95];
  const elapsedSec = elapsedSeconds(selected.updated_at || selected.created_at);

  let expectedSec = 120;
  if (selected.stage === 'normalize_audio') {
    expectedSec = Math.max(40, Math.floor((selected.duration_sec || 0) * 0.08));
  } else if (selected.stage === 'stt_diarization') {
    // CPU + diarization can be slow; use conservative estimate so bar moves gradually.
    expectedSec = Math.max(300, Math.floor((selected.duration_sec || 0) * 2.2));
  } else if (selected.stage === 'codex_structure' || selected.stage === 'merge') {
    expectedSec = 180;
  } else if (selected.stage === 'render_html') {
    expectedSec = 45;
  } else if (selected.stage === 'notion_writeback') {
    expectedSec = 90;
  }

  const ratio = Math.min(0.98, elapsedSec / expectedSec);
  return Math.floor(minP + (maxP - minP) * ratio);
}

function setImportStatus(text, kind = false) {
  const isError = kind === true || kind === 'error';
  const isWarning = kind === 'warning';
  importStatus.textContent = text;
  importStatus.classList.toggle('error', isError);
  importStatus.classList.toggle('warning', !isError && isWarning);
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
  const mockFallbackText = hasMockFallback(selected) ? ' | mock fallback used' : '';

  selectedJobInfo.textContent =
    `Выбрано: ${selected.id} | status=${selected.status} | stage=${selected.stage}${mockFallbackText} | ${warningOrError}`;
}

function setProgressForSelectedJob() {
  const selected = getSelectedJob();
  if (!selected) {
    jobProgressStatus.textContent = 'Прогресс: задача не выбрана';
    jobProgressBar.style.width = '0%';
    jobProgressBar.classList.remove('running', 'failed');
    return;
  }

  let percent = stageProgress[selected.stage] ?? 8;
  let suffix = '';
  const liveProgress = liveProgressByJob.get(selected.id) || null;

  if (selected.status === 'queued') {
    percent = Math.max(percent, 6);
    suffix = ` | в очереди ${formatElapsed(selected.created_at)}`;
  } else if (selected.status === 'running') {
    if (liveProgress && Number.isFinite(liveProgress.percent)) {
      let displayPercent = liveProgress.percent;
      const signalAgeSec = Math.max(
        0,
        Math.floor((Date.now() - Number(liveProgress.updatedAtMs || Date.now())) / 1000)
      );
      if (signalAgeSec > 30) {
        const softCreep = Math.floor((signalAgeSec - 30) / 45);
        const upper = selected.stage === 'stt_diarization' ? 51 : 98;
        displayPercent = Math.min(upper, liveProgress.percent + Math.max(0, softCreep));
      }

      percent = Math.max(estimateRunningPercent(selected), displayPercent);
      suffix = ` | выполняется ${formatElapsed(selected.updated_at || selected.created_at)}`;
      if (liveProgress.message) {
        suffix += ` | ${liveProgress.message}`;
      }
      suffix += ` | последний сигнал: ${formatDuration(signalAgeSec)} назад`;
      if (liveProgress.logFile) {
        suffix += ` | лог: ${liveProgress.logFile}`;
      }
    } else {
      percent = estimateRunningPercent(selected);
      suffix = ` | выполняется ${formatElapsed(selected.updated_at || selected.created_at)}`;
    }
  } else if (selected.status === 'done') {
    percent = 100;
    suffix = ' | готово';
  } else if (selected.status === 'failed') {
    percent = 100;
    suffix = ` | ошибка: ${selected.error_message || 'unknown'}`;
  }

  jobProgressBar.style.width = `${Math.min(100, Math.max(0, percent))}%`;
  jobProgressBar.classList.toggle('running', selected.status === 'running');
  jobProgressBar.classList.toggle('failed', selected.status === 'failed');
  jobProgressStatus.textContent =
    `Прогресс: ${percent}% | ${stageLabels[selected.stage] ?? selected.stage} (${selected.status})${suffix}`;
}

function setQueueSummary(rows) {
  const total = rows.length;
  const queued = rows.filter((row) => row.status === 'queued').length;
  const running = rows.filter((row) => row.status === 'running').length;
  const done = rows.filter((row) => row.status === 'done').length;
  const failed = rows.filter((row) => row.status === 'failed').length;
  queueInfo.textContent = `Очередь: total=${total}, queued=${queued}, running=${running}, done=${done}, failed=${failed}`;
}

function updateActionButtons() {
  const selected = getSelectedJob();
  const hasSelection = Boolean(selected);
  const canOpenResults = hasSelection && selected.status === 'done';

  openHtmlBtn.disabled = !canOpenResults;
  openMdBtn.disabled = !canOpenResults;
  writebackNotionBtn.disabled = !canOpenResults;
  retryJobBtn.disabled = !hasSelection;

  if (!hasSelection) {
    actionHint.textContent = 'Подсказка: выберите задачу в таблице.';
    return;
  }

  if (selected.status === 'done') {
    actionHint.textContent =
      hasMockFallback(selected)
        ? 'Подсказка: задача завершена через mock fallback. Проверьте warning и запустите повтор после настройки STT.'
        : 'Подсказка: задача готова, можно открыть HTML/MD и отправить в Notion.';
    return;
  }

  if (selected.status === 'failed') {
    actionHint.textContent = 'Подсказка: задача упала. Нажмите "Повторить задачу".';
    return;
  }

  actionHint.textContent =
    'Подсказка: результаты открываются после `done`. Сейчас задача ещё обрабатывается.';
}

function hasMockFallback(row) {
  const text = String(row?.warning || '').toLowerCase();
  return text.includes('fallback to mock transcript') || text.includes('mock stt result');
}

function extractNotionSuggestions(errorDetails) {
  if (!errorDetails || typeof errorDetails !== 'object') {
    return [];
  }
  const source = Array.isArray(errorDetails.suggestions) ? errorDetails.suggestions : [];
  return source
    .map((item) => (typeof item?.title === 'string' ? item.title.trim() : ''))
    .filter(Boolean)
    .slice(0, 8);
}

function renderJobs(rows) {
  jobs = rows || [];
  const runningIds = new Set(jobs.filter((row) => row.status === 'running').map((row) => row.id));
  for (const jobId of liveProgressByJob.keys()) {
    if (!runningIds.has(jobId)) {
      liveProgressByJob.delete(jobId);
    }
  }
  ensureSelectedJob(jobs);
  setQueueSummary(jobs);

  jobsBody.innerHTML = '';

  if (jobs.length === 0) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="7" class="muted">Пока нет задач</td>`;
    jobsBody.append(tr);
    setSelectedJobInfo();
    setProgressForSelectedJob();
    updateActionButtons();
    return;
  }

  for (const row of jobs) {
    const tr = document.createElement('tr');
    tr.className = row.id === selectedJobId ? 'selected-row' : '';
    tr.dataset.jobId = row.id;

    const issueText = row.error_message
      ? `${row.error_code || 'ERROR'}: ${row.error_message}`
      : hasMockFallback(row)
        ? `mock fallback used${row.warning ? `; ${row.warning}` : ''}`
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
  setProgressForSelectedJob();
  updateActionButtons();
}

async function refreshJobs() {
  const rows = await api.listJobs();
  renderJobs(rows);
}

function startJobsPolling() {
  if (jobsPollTimer) {
    return;
  }

  jobsPollTimer = setInterval(() => {
    refreshJobs().catch((error) => {
      setImportStatus(`Не удалось обновить задачи: ${error.message}`, true);
    });
  }, 3000);
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

cleanupFailedBtn.addEventListener('click', () => {
  withStatus('Очищаем упавшие задачи...', async () => {
    const result = await api.cleanupFailedJobs();
    setImportStatus(
      `Удалено задач: ${result?.deletedJobs ?? 0}, удалено записей: ${result?.deletedRecordings ?? 0}`
    );
    await refreshJobs();
  });
});

writebackNotionBtn.addEventListener('click', () => {
  withStatus('Отправляем merged в Notion...', async () => {
    const selected = getSelectedJob();
    if (!selected) {
      throw new Error('Сначала выберите задачу');
    }

    const pageTitle = String(notionPageTitleInput?.value || '').trim();
    if (!pageTitle) {
      setImportStatus('Введите название подстраницы Notion в поле над кнопками.', 'error');
      return;
    }

    const result = await api.writebackNotion(selected.recording_id, pageTitle);
    if (!result?.ok) {
      const error = result?.error || {};
      const code = error.code || 'NOTION_WRITEBACK_FAILED';
      const message = error.message || 'unknown error';
      const suggestions = extractNotionSuggestions(error.details);
      if (suggestions.length > 0) {
        setImportStatus(
          `Notion ошибка [${code}]: ${message}. Возможные страницы: ${suggestions.join(', ')}`,
          'error'
        );
      } else {
        setImportStatus(`Notion ошибка [${code}]: ${message}`, 'error');
      }
      return;
    }

    if (result?.warning) {
      const logFile = typeof result.logPath === 'string' ? result.logPath.split(/[\\/]/).pop() : '';
      setImportStatus(`Notion: ${result.warning}${logFile ? ` (лог: ${logFile})` : ''}`, 'warning');
      return;
    }

    const logFile = typeof result.logPath === 'string' ? result.logPath.split(/[\\/]/).pop() : '';
    setImportStatus(
      `Notion: записано ${result?.blocksWritten ?? 0} блоков${logFile ? ` (лог: ${logFile})` : ''}`
    );
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
    cleanupFailedBtn,
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
    if (payload?.jobId) {
      if (payload.status === 'running' && Number.isFinite(payload.progressPercent)) {
        const rawLogPath = typeof payload.logPath === 'string' ? payload.logPath : '';
        const logFile = rawLogPath.split(/[\\/]/).pop() || '';
        liveProgressByJob.set(payload.jobId, {
          percent: payload.progressPercent,
          message: typeof payload.progressMessage === 'string' ? payload.progressMessage : '',
          logFile,
          updatedAtMs: Date.now()
        });
      } else if (payload.status === 'done' || payload.status === 'failed') {
        liveProgressByJob.delete(payload.jobId);
      }
    }

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

  startJobsPolling();

  refreshJobs().catch((error) => {
    setImportStatus(`Не удалось загрузить список задач: ${error.message}`, true);
  });
}

window.addEventListener('beforeunload', () => {
  if (jobsPollTimer) {
    clearInterval(jobsPollTimer);
    jobsPollTimer = null;
  }
});
