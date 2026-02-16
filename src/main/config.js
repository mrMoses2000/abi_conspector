import path from 'node:path';
import { app } from 'electron';

const MAX_LECTURE_SECONDS = 3 * 60 * 60;

function parseBoolean(value, fallback) {
  if (value === undefined) {
    return fallback;
  }
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
}

function parseIntSafe(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function getDataRoot() {
  return path.join(app.getPath('userData'), 'data');
}

export function getManagedPaths() {
  const root = getDataRoot();
  return {
    root,
    audio: path.join(root, 'audio'),
    imports: path.join(root, 'imports'),
    transcripts: path.join(root, 'transcripts'),
    structured: path.join(root, 'structured'),
    merged: path.join(root, 'merged'),
    html: path.join(root, 'html'),
    backups: path.join(root, 'backups')
  };
}

export function getDatabasePath() {
  return path.join(getDataRoot(), 'app.db');
}

export function getRuntimeConfig() {
  const projectRoot = process.cwd();
  const sttMode = process.env.CONSPECTOR_STT_MODE === 'mock' ? 'mock' : 'real';
  const codexMode = process.env.CONSPECTOR_CODEX_MODE === 'mock' ? 'mock' : 'real';
  const notionMode = process.env.CONSPECTOR_NOTION_MODE === 'real' ? 'real' : 'off';

  return {
    ffmpeg: {
      sampleRateHz: 16_000,
      channels: 1,
      format: 'flac'
    },
    stt: {
      mode: sttMode,
      pythonBin: process.env.CONSPECTOR_STT_PYTHON || 'python3',
      scriptPath:
        process.env.CONSPECTOR_STT_SCRIPT || path.join(projectRoot, 'scripts', 'run_stt_diarization.py'),
      model: process.env.CONSPECTOR_WHISPER_MODEL || 'medium',
      language: process.env.CONSPECTOR_STT_LANGUAGE || 'ru',
      device: process.env.CONSPECTOR_STT_DEVICE || 'cpu',
      computeType: process.env.CONSPECTOR_STT_COMPUTE_TYPE || 'int8',
      batchSize: parseIntSafe(process.env.CONSPECTOR_STT_BATCH_SIZE, 8),
      hfToken: process.env.HUGGINGFACE_TOKEN || '',
      requireDiarization: parseBoolean(process.env.CONSPECTOR_REQUIRE_DIARIZATION, true),
      timeoutMs: parseIntSafe(process.env.CONSPECTOR_STT_TIMEOUT_SEC, 1800) * 1000
    },
    codex: {
      mode: codexMode,
      fullAuto: parseBoolean(process.env.CONSPECTOR_CODEX_FULL_AUTO, true),
      model: process.env.CONSPECTOR_CODEX_MODEL || '',
      reasoningEffort: process.env.CONSPECTOR_CODEX_EFFORT || 'medium',
      timeoutMs: parseIntSafe(process.env.CONSPECTOR_CODEX_TIMEOUT_SEC, 600) * 1000,
      workdir: process.env.CONSPECTOR_CODEX_WORKDIR || projectRoot,
      sourceNotePath: process.env.CONSPECTOR_SOURCE_NOTE_PATH || ''
    },
    notion: {
      mode: notionMode,
      token: process.env.NOTION_TOKEN || '',
      pageId: process.env.CONSPECTOR_NOTION_PAGE_ID || '',
      pageTitle: process.env.CONSPECTOR_NOTION_PAGE_TITLE || '',
      rootPageId: process.env.CONSPECTOR_NOTION_ROOT_PAGE_ID || ''
    },
    resilience: {
      sttFallbackToMock: parseBoolean(process.env.CONSPECTOR_STT_FALLBACK_TO_MOCK, true),
      codexFallbackToMock: parseBoolean(process.env.CONSPECTOR_CODEX_FALLBACK_TO_MOCK, true),
      notionSoftFail: parseBoolean(process.env.CONSPECTOR_NOTION_SOFT_FAIL, true),
      continueWithoutHtml: parseBoolean(process.env.CONSPECTOR_HTML_SOFT_FAIL, true),
      preflightStrict: parseBoolean(process.env.CONSPECTOR_PREFLIGHT_STRICT, false)
    },
    maxLectureSeconds: MAX_LECTURE_SECONDS,
    queueConcurrency: 1
  };
}
