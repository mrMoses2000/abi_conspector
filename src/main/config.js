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

function parseEnum(value, allowed, fallback) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return allowed.includes(normalized) ? normalized : fallback;
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
  const geminiMode = process.env.CONSPECTOR_GEMINI_MODE === 'mock' ? 'mock' : 'real';
  const llmProvider = parseEnum(process.env.CONSPECTOR_LLM_PROVIDER, ['codex', 'gemini'], 'codex');
  const notionMode = process.env.CONSPECTOR_NOTION_MODE === 'real' ? 'real' : 'off';
  const sttPrimary = parseEnum(process.env.CONSPECTOR_STT_PRIMARY, ['groq', 'whispercpp'], 'groq');
  const sttFallback = parseEnum(process.env.CONSPECTOR_STT_FALLBACK, ['whispercpp', 'none'], 'whispercpp');

  return {
    ffmpeg: {
      sampleRateHz: 16_000,
      channels: 1,
      format: 'flac'
    },
    stt: {
      mode: sttMode,
      primary: sttPrimary,
      fallback: sttFallback,
      model: process.env.CONSPECTOR_WHISPER_MODEL || 'medium',
      language: process.env.CONSPECTOR_STT_LANGUAGE || 'ru',
      timeoutMs: parseIntSafe(process.env.CONSPECTOR_STT_TIMEOUT_SEC, 1800) * 1000,
      groqApiKey: process.env.CONSPECTOR_GROQ_API_KEY || process.env.GROQ_API_KEY || '',
      groqModel: process.env.CONSPECTOR_GROQ_MODEL || 'whisper-large-v3',
      groqMaxFileMb: parseIntSafe(process.env.CONSPECTOR_GROQ_MAX_FILE_MB, 25),
      groqChunkMinutes: parseIntSafe(process.env.CONSPECTOR_GROQ_CHUNK_MIN, 18),
      whisperCppBin: process.env.CONSPECTOR_WHISPERCPP_BIN || 'whisper-cli',
      whisperCppModelPath:
        process.env.CONSPECTOR_WHISPERCPP_MODEL_PATH || path.join(projectRoot, 'models', 'ggml-base.bin'),
      whisperCppThreads: parseIntSafe(process.env.CONSPECTOR_WHISPERCPP_THREADS, 2)
    },
    llm: {
      provider: llmProvider
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
    gemini: {
      mode: geminiMode,
      model: process.env.CONSPECTOR_GEMINI_MODEL || 'gemini-3-flash-preview',
      timeoutMs: parseIntSafe(process.env.CONSPECTOR_GEMINI_TIMEOUT_SEC, 600) * 1000,
      workdir: process.env.CONSPECTOR_GEMINI_WORKDIR || projectRoot,
      sourceNotePath: process.env.CONSPECTOR_SOURCE_NOTE_PATH || '',
      sandbox: parseBoolean(process.env.CONSPECTOR_GEMINI_SANDBOX, false)
    },
    notion: {
      mode: notionMode,
      token: process.env.NOTION_TOKEN || '',
      pageId: process.env.CONSPECTOR_NOTION_PAGE_ID || '',
      pageTitle: process.env.CONSPECTOR_NOTION_PAGE_TITLE || '',
      rootPageId: process.env.CONSPECTOR_NOTION_ROOT_PAGE_ID || '',
      mergeWithExisting: parseBoolean(process.env.CONSPECTOR_NOTION_MERGE_WITH_EXISTING, true)
    },
    resilience: {
      sttFallbackToMock: parseBoolean(process.env.CONSPECTOR_STT_FALLBACK_TO_MOCK, false),
      codexFallbackToMock: parseBoolean(process.env.CONSPECTOR_CODEX_FALLBACK_TO_MOCK, true),
      notionSoftFail: parseBoolean(process.env.CONSPECTOR_NOTION_SOFT_FAIL, true),
      continueWithoutHtml: parseBoolean(process.env.CONSPECTOR_HTML_SOFT_FAIL, true),
      preflightStrict: parseBoolean(process.env.CONSPECTOR_PREFLIGHT_STRICT, false)
    },
    maxLectureSeconds: MAX_LECTURE_SECONDS,
    queueConcurrency: 1
  };
}
