import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import multer from 'multer';
import { writeMergedToNotion } from '../src/main/workers/notionWorker.js';
import { getMergeFromMarkdownWorker, getLlmConfigKey } from '../src/main/workers/llmProvider.js';
import { ControlledError, asIpcError } from '../src/main/utils/errors.js';
import { AppDatabase } from '../src/main/db/database.js';
import { MergeQueue } from '../src/main/pipeline/mergeQueue.js';
import { createMergePipeline } from '../src/main/pipeline/mergePipeline.js';
import { ingestManagedAudio } from '../src/main/audio/ingestAudio.js';
import { ensureDirs } from '../src/main/utils/fs.js';

const app = express();
const PORT = Number.parseInt(process.env.CONSPECTOR_WEB_PORT || '8787', 10);

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

function defaultDataRoot() {
  if (process.env.CONSPECTOR_DATA_ROOT) {
    return process.env.CONSPECTOR_DATA_ROOT;
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'abi-conspector', 'data');
  }
  if (process.platform === 'linux') {
    return path.join(os.homedir(), '.config', 'abi-conspector', 'data');
  }
  return path.join(process.cwd(), 'data');
}

function parseAdminEmails() {
  return new Set(
    String(process.env.CONSPECTOR_ADMIN_EMAILS || '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  );
}

function nowIso() {
  return new Date().toISOString();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function sanitizeRecordingId(value) {
  const normalized = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]+$/.test(normalized)) {
    throw new ControlledError('INVALID_RECORDING_ID', 'Invalid recording id');
  }
  return normalized;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') {
    return false;
  }
  const salt = parts[1];
  const expected = Buffer.from(parts[2], 'hex');
  const actual = crypto.scryptSync(password, salt, 64);
  if (expected.length !== actual.length) {
    return false;
  }
  return crypto.timingSafeEqual(expected, actual);
}

function createSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

function expiresAtIso(days) {
  const ms = Math.max(1, days) * 24 * 60 * 60 * 1000;
  return new Date(Date.now() + ms).toISOString();
}

function toSafeUser(row) {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    createdAt: row.created_at
  };
}

const dataRoot = defaultDataRoot();
const webDbPath = process.env.CONSPECTOR_WEB_DB_PATH || path.join(dataRoot, 'web.db');
const conspectorDbPath = path.join(dataRoot, 'app.db');
const publicDir = path.join(process.cwd(), 'web', 'public');
const adminEmailAllowlist = parseAdminEmails();
const parsedSessionDays = Number.parseInt(process.env.CONSPECTOR_WEB_SESSION_DAYS || '30', 10);
const sessionDays = Number.isFinite(parsedSessionDays) && parsedSessionDays > 0 ? parsedSessionDays : 30;

await fsp.mkdir(path.dirname(webDbPath), { recursive: true });
const webDb = new DatabaseSync(webDbPath);
webDb.exec('PRAGMA journal_mode=WAL;');
webDb.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
`);

const insertUserStmt = webDb.prepare(`
  INSERT INTO users (id, email, password_hash, role, created_at)
  VALUES (?, ?, ?, ?, ?)
`);
const getUserByEmailStmt = webDb.prepare(`
  SELECT id, email, password_hash, role, created_at
  FROM users
  WHERE email = ?
`);
const getUserByIdStmt = webDb.prepare(`
  SELECT id, email, password_hash, role, created_at
  FROM users
  WHERE id = ?
`);
const updateUserRoleStmt = webDb.prepare(`
  UPDATE users
  SET role = ?
  WHERE id = ?
`);
const insertSessionStmt = webDb.prepare(`
  INSERT INTO sessions (token, user_id, expires_at, created_at)
  VALUES (?, ?, ?, ?)
`);
const deleteSessionStmt = webDb.prepare(`
  DELETE FROM sessions
  WHERE token = ?
`);
const cleanupSessionsStmt = webDb.prepare(`
  DELETE FROM sessions
  WHERE expires_at <= ?
`);
const getSessionStmt = webDb.prepare(`
  SELECT s.token, s.user_id, s.expires_at, u.id, u.email, u.role, u.created_at
  FROM sessions s
  INNER JOIN users u ON u.id = s.user_id
  WHERE s.token = ?
`);
const listUsersStmt = webDb.prepare(`
  SELECT id, email, role, created_at
  FROM users
  ORDER BY created_at DESC
`);

app.use(express.json({ limit: '2mb' }));

// ─── Managed paths for pipeline ───
function parseBoolean2(value, fallback) {
  if (value === undefined) return fallback;
  const n = String(value).trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(n) ? true :
    ['0', 'false', 'no', 'off'].includes(n) ? false : fallback;
}
function parseIntSafe2(value, fallback) {
  const p = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(p) ? p : fallback;
}
function parseEnum2(value, allowed, fallback) {
  const n = String(value ?? '').trim().toLowerCase();
  return allowed.includes(n) ? n : fallback;
}
function parseFallbackChain(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return [];
  }
  return raw
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
}
const managedPaths = {
  root: dataRoot,
  audio: path.join(dataRoot, 'audio'),
  imports: path.join(dataRoot, 'imports'),
  transcripts: path.join(dataRoot, 'transcripts'),
  structured: path.join(dataRoot, 'structured'),
  merged: path.join(dataRoot, 'merged'),
  html: path.join(dataRoot, 'html'),
  subjects: path.join(dataRoot, 'subjects'),
  backups: path.join(dataRoot, 'backups')
};

// ─── Runtime config for pipeline (web-compatible, no Electron dependency) ───
const projectRoot = process.cwd();
const MAX_LECTURE_SECONDS = 3 * 60 * 60;
const runtimeConfig = {
  ffmpeg: { sampleRateHz: 16_000, channels: 1, format: 'flac' },
  stt: {
    mode: process.env.CONSPECTOR_STT_MODE === 'mock' ? 'mock' : 'real',
    primary: parseEnum2(process.env.CONSPECTOR_STT_PRIMARY, ['groq', 'whispercpp'], 'groq'),
    fallback: parseEnum2(process.env.CONSPECTOR_STT_FALLBACK, ['whispercpp', 'none'], 'whispercpp'),
    fallbackChain: parseFallbackChain(process.env.CONSPECTOR_STT_FALLBACK_CHAIN),
    model: process.env.CONSPECTOR_WHISPER_MODEL || 'medium',
    language: process.env.CONSPECTOR_STT_LANGUAGE || 'ru',
    timeoutMs: parseIntSafe2(process.env.CONSPECTOR_STT_TIMEOUT_SEC, 1800) * 1000,
    groqApiKey: process.env.CONSPECTOR_GROQ_API_KEY || process.env.GROQ_API_KEY || '',
    groqModel: process.env.CONSPECTOR_GROQ_MODEL || 'whisper-large-v3-turbo',
    groqMaxFileMb: parseIntSafe2(process.env.CONSPECTOR_GROQ_MAX_FILE_MB, 25),
    groqChunkMinutes: parseIntSafe2(process.env.CONSPECTOR_GROQ_CHUNK_MIN, 18),
    assemblyaiApiKey: process.env.ASSEMBLYAI_API_KEY || '',
    deepgramApiKey: process.env.DEEPGRAM_API_KEY || '',
    deepgramModel: process.env.CONSPECTOR_DEEPGRAM_MODEL || 'nova-2',
    whisperCppBin: process.env.CONSPECTOR_WHISPERCPP_BIN || 'whisper-cli',
    whisperCppModelPath: process.env.CONSPECTOR_WHISPERCPP_MODEL_PATH || path.join(projectRoot, 'models', 'ggml-base.bin'),
    whisperCppThreads: parseIntSafe2(process.env.CONSPECTOR_WHISPERCPP_THREADS, 2)
  },
  llm: { provider: parseEnum2(process.env.CONSPECTOR_LLM_PROVIDER, ['codex', 'gemini'], 'codex') },
  codex: {
    mode: process.env.CONSPECTOR_CODEX_MODE === 'mock' ? 'mock' : 'real',
    fullAuto: parseBoolean2(process.env.CONSPECTOR_CODEX_FULL_AUTO, true),
    model: process.env.CONSPECTOR_CODEX_MODEL || '',
    reasoningEffort: process.env.CONSPECTOR_CODEX_EFFORT || 'medium',
    timeoutMs: parseIntSafe2(process.env.CONSPECTOR_CODEX_TIMEOUT_SEC, 600) * 1000,
    workdir: process.env.CONSPECTOR_CODEX_WORKDIR || projectRoot,
    sourceNotePath: process.env.CONSPECTOR_SOURCE_NOTE_PATH || ''
  },
  gemini: {
    mode: process.env.CONSPECTOR_GEMINI_MODE === 'mock' ? 'mock' : 'real',
    model: process.env.CONSPECTOR_GEMINI_MODEL || 'gemini-3-flash-preview',
    timeoutMs: parseIntSafe2(process.env.CONSPECTOR_GEMINI_TIMEOUT_SEC, 600) * 1000,
    workdir: process.env.CONSPECTOR_GEMINI_WORKDIR || projectRoot,
    sourceNotePath: process.env.CONSPECTOR_SOURCE_NOTE_PATH || '',
    sandbox: parseBoolean2(process.env.CONSPECTOR_GEMINI_SANDBOX, false)
  },
  notion: {
    mode: process.env.CONSPECTOR_NOTION_MODE === 'real' ? 'real' : 'off',
    token: process.env.NOTION_TOKEN || '',
    pageId: process.env.CONSPECTOR_NOTION_PAGE_ID || '',
    pageTitle: process.env.CONSPECTOR_NOTION_PAGE_TITLE || '',
    rootPageId: process.env.CONSPECTOR_NOTION_ROOT_PAGE_ID || '',
    mergeWithExisting: parseBoolean2(process.env.CONSPECTOR_NOTION_MERGE_WITH_EXISTING, true)
  },
  resilience: {
    sttFallbackToMock: parseBoolean2(process.env.CONSPECTOR_STT_FALLBACK_TO_MOCK, false),
    codexFallbackToMock: parseBoolean2(process.env.CONSPECTOR_CODEX_FALLBACK_TO_MOCK, true),
    notionSoftFail: parseBoolean2(process.env.CONSPECTOR_NOTION_SOFT_FAIL, true),
    continueWithoutHtml: parseBoolean2(process.env.CONSPECTOR_HTML_SOFT_FAIL, true),
    preflightStrict: parseBoolean2(process.env.CONSPECTOR_PREFLIGHT_STRICT, false)
  },
  maxLectureSeconds: MAX_LECTURE_SECONDS,
  queueConcurrency: 1
};

// ─── Bootstrap pipeline ───
await ensureDirs([
  managedPaths.root, managedPaths.audio, managedPaths.imports,
  managedPaths.transcripts, managedPaths.structured,
  managedPaths.merged, managedPaths.html, managedPaths.subjects,
  managedPaths.backups
]);

const appDb = new AppDatabase(conspectorDbPath);
const recovered = appDb.recoverStaleJobs();
if (recovered > 0) {
  process.stderr.write(`[web] recovered stale merge jobs: ${recovered}\n`);
}

const pipeline = createMergePipeline({
  db: appDb,
  managedPaths,
  runtimeConfig: {
    ...runtimeConfig,
    // Disable auto Notion writeback in pipeline — user triggers via button
    notion: { ...runtimeConfig.notion, mode: 'off' }
  }
});

const mergeQueue = new MergeQueue({
  worker: (jobId, notify) => pipeline.processJob(jobId, notify)
});

// Log pipeline events
mergeQueue.on('job:started', ({ jobId }) => {
  process.stdout.write(`[pipeline] job started: ${jobId}\n`);
});
mergeQueue.on('job:finished', ({ jobId }) => {
  process.stdout.write(`[pipeline] job finished: ${jobId}\n`);
});
mergeQueue.on('job:failed', ({ jobId, error }) => {
  process.stderr.write(`[pipeline] job failed: ${jobId} — ${error}\n`);
});

// ─── Multer upload config ───
const upload = multer({
  dest: managedPaths.imports,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB
  fileFilter: (_req, file, cb) => {
    const allowed = /^(audio|video)\//;
    if (allowed.test(file.mimetype) || /\.(mp3|wav|ogg|m4a|flac|aac|wma|webm|mp4|opus)$/i.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new ControlledError('INVALID_FILE_TYPE', 'Only audio/video files are accepted'));
    }
  }
});

function getBearerToken(req) {
  const header = String(req.headers.authorization || '').trim();
  if (!header.toLowerCase().startsWith('bearer ')) {
    return '';
  }
  return header.slice(7).trim();
}

function createSessionForUser(userId) {
  cleanupSessionsStmt.run(nowIso());
  const token = createSessionToken();
  insertSessionStmt.run(token, userId, expiresAtIso(sessionDays), nowIso());
  return token;
}

function requireAuth(req, res, next) {
  const token = getBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'AUTH_REQUIRED', message: 'Authorization token is required' });
    return;
  }

  const row = getSessionStmt.get(token);
  if (!row || row.expires_at <= nowIso()) {
    if (row?.token) {
      deleteSessionStmt.run(row.token);
    }
    res.status(401).json({ error: 'AUTH_EXPIRED', message: 'Session is invalid or expired' });
    return;
  }

  req.authToken = token;
  req.user = {
    id: row.id,
    email: row.email,
    role: row.role,
    created_at: row.created_at
  };
  next();
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'FORBIDDEN', message: 'Admin role is required' });
    return;
  }
  next();
}

function resolveRoleByEmail(email) {
  return adminEmailAllowlist.has(email) ? 'admin' : 'user';
}

function maybeSyncAdminRole(user) {
  const expectedRole = resolveRoleByEmail(user.email);
  if (expectedRole !== user.role) {
    updateUserRoleStmt.run(expectedRole, user.id);
    return { ...user, role: expectedRole };
  }
  return user;
}

function listConspectsFromDb() {
  if (!fs.existsSync(conspectorDbPath)) {
    return [];
  }

  const conspectorDb = new DatabaseSync(conspectorDbPath, { readOnly: true });
  try {
    const rows = conspectorDb
      .prepare(
        `
        SELECT
          r.id AS recording_id,
          r.source_type,
          r.original_file_name,
          r.subject_id,
          s.name AS subject_name,
          r.duration_sec,
          r.created_at,
          j.id AS job_id,
          j.stage,
          j.status,
          j.warning,
          j.error_code,
          j.error_message,
          j.updated_at
        FROM recordings r
        LEFT JOIN subjects s ON s.id = r.subject_id
        LEFT JOIN merge_jobs j
          ON j.id = (
            SELECT j2.id
            FROM merge_jobs j2
            WHERE j2.recording_id = r.id
            ORDER BY j2.created_at DESC
            LIMIT 1
          )
        ORDER BY r.created_at DESC
        LIMIT 500
      `
      )
      .all();

    return rows.map((row) => {
      const recordingId = row.recording_id;
      const htmlPath = path.join(dataRoot, 'html', `${recordingId}.html`);
      const mdPath = path.join(dataRoot, 'merged', `${recordingId}.md`);
      const warning = row.warning || '';
      return {
        recordingId,
        fileName: row.original_file_name || recordingId,
        subjectId: row.subject_id || null,
        subjectName: row.subject_name || null,
        sourceType: row.source_type || 'unknown',
        durationSec: row.duration_sec || 0,
        createdAt: row.created_at,
        status: row.status || 'unknown',
        stage: row.stage || 'unknown',
        warning,
        errorCode: row.error_code || null,
        errorMessage: row.error_message || null,
        mockFallbackUsed: String(warning).toLowerCase().includes('fallback to mock'),
        htmlAvailable: fs.existsSync(htmlPath),
        markdownAvailable: fs.existsSync(mdPath)
      };
    });
  } finally {
    conspectorDb.close();
  }
}

function listConspectsFromHtmlDir() {
  const htmlDir = path.join(dataRoot, 'html');
  if (!fs.existsSync(htmlDir)) {
    return [];
  }

  const entries = fs
    .readdirSync(htmlDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.html'))
    .map((entry) => {
      const recordingId = entry.name.slice(0, -'.html'.length);
      return {
        recordingId,
        fileName: recordingId,
        subjectId: null,
        subjectName: null,
        sourceType: 'unknown',
        durationSec: 0,
        createdAt: null,
        status: 'done',
        stage: 'done',
        warning: '',
        errorCode: null,
        errorMessage: null,
        mockFallbackUsed: false,
        htmlAvailable: true,
        markdownAvailable: fs.existsSync(path.join(dataRoot, 'merged', `${recordingId}.md`))
      };
    });

  return entries;
}

function listConspects() {
  const fromDb = listConspectsFromDb();
  if (fromDb.length > 0) {
    return fromDb;
  }
  return listConspectsFromHtmlDir();
}

// ─── Subject CRUD endpoints ───

app.get('/api/subjects', requireAuth, (_req, res) => {
  const subjects = appDb.listSubjects();
  res.json({ ok: true, subjects });
});

app.post('/api/subjects', requireAuth, requireAdmin, (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) {
    res.status(400).json({ ok: false, error: { code: 'NAME_REQUIRED', message: 'Subject name is required' } });
    return;
  }
  // Check for duplicate
  const existing = appDb.getSubjectByName(name);
  if (existing) {
    res.status(409).json({ ok: false, error: { code: 'DUPLICATE_SUBJECT', message: `Subject "${name}" already exists` } });
    return;
  }
  const subject = appDb.createSubject(name);
  res.json({ ok: true, subject });
});

app.get('/api/subjects/:subjectId', requireAuth, (req, res) => {
  const subjectId = req.params.subjectId;
  const subject = appDb.getSubject(subjectId);
  if (!subject) {
    res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Subject not found' } });
    return;
  }
  const recordings = appDb.listRecordingsBySubject(subjectId);
  res.json({ ok: true, subject, recordings });
});

app.get('/api/subjects/:subjectId/html', requireAuth, (req, res) => {
  try {
    const subject = appDb.getSubject(req.params.subjectId);
    if (!subject) {
      return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Subject not found' } });
    }
    const subjectDir = path.resolve(managedPaths.subjects, subject.id);
    const htmlPath = path.join(subjectDir, 'conspect.html');
    if (!fs.existsSync(htmlPath)) {
      return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'HTML conspect not yet generated for this subject' } });
    }
    const content = fs.readFileSync(htmlPath, 'utf8');
    res.type('text/html').send(content);
  } catch (error) {
    if (!res.headersSent) {
      const ipcError = asIpcError(error);
      res.status(error instanceof ControlledError ? 400 : 500).json({ ok: false, error: ipcError });
    }
  }
});

app.get('/api/subjects/:subjectId/md', requireAuth, (req, res) => {
  try {
    const subject = appDb.getSubject(req.params.subjectId);
    if (!subject) {
      return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Subject not found' } });
    }
    const subjectDir = path.resolve(managedPaths.subjects, subject.id);
    const mdPath = path.join(subjectDir, 'merged.md');
    if (!fs.existsSync(mdPath)) {
      return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Merged MD not yet generated for this subject' } });
    }
    const content = fs.readFileSync(mdPath, 'utf8');
    res.type('text/markdown').send(content);
  } catch (error) {
    if (!res.headersSent) {
      const ipcError = asIpcError(error);
      res.status(error instanceof ControlledError ? 400 : 500).json({ ok: false, error: ipcError });
    }
  }
});

app.post('/api/subjects/:subjectId/notion', requireAuth, requireAdmin, async (req, res) => {
  try {
    // Early check: reject if Notion is disabled
    if (process.env.CONSPECTOR_NOTION_MODE !== 'real') {
      return res.status(400).json({
        ok: false,
        error: {
          code: 'NOTION_DISABLED',
          message: 'Notion writeback отключён. Установите CONSPECTOR_NOTION_MODE=real в .env на сервере.'
        }
      });
    }
    if (!process.env.NOTION_TOKEN) {
      return res.status(400).json({
        ok: false,
        error: {
          code: 'NOTION_TOKEN_MISSING',
          message: 'NOTION_TOKEN не настроен в .env на сервере.'
        }
      });
    }

    const subject = appDb.getSubject(req.params.subjectId);
    if (!subject) {
      return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Subject not found' } });
    }
    const subjectDir = path.resolve(managedPaths.subjects, subject.id);
    const mergedPath = path.join(subjectDir, 'merged.md');
    if (!fs.existsSync(mergedPath)) {
      return res.status(404).json({ ok: false, error: { code: 'MERGED_NOT_FOUND', message: 'No merged conspect for this subject yet' } });
    }

    const notionConfig = {
      mode: 'real',
      token: process.env.NOTION_TOKEN,
      pageId: process.env.CONSPECTOR_NOTION_PAGE_ID || '',
      pageTitle: subject.name,
      rootPageId: process.env.CONSPECTOR_NOTION_ROOT_PAGE_ID || '',
      mergeWithExisting: parseBoolean(process.env.CONSPECTOR_NOTION_MERGE_WITH_EXISTING, true)
    };

    const llmProvider = runtimeConfig.llm?.provider || 'codex';
    const llmConfigKey = getLlmConfigKey(llmProvider);
    const llmConfig = runtimeConfig[llmConfigKey];
    const llmMergeFromMarkdown = getMergeFromMarkdownWorker(llmProvider);

    const backupsDir = path.join(dataRoot, 'backups');
    const result = await writeMergedToNotion({
      mergedPath,
      recording: { id: subject.id, original_file_name: subject.name },
      backupsDir,
      notionConfig,
      llmMergeFromMarkdown,
      llmConfig
    });
    res.json({ ok: true, ...result });
  } catch (error) {
    const ipcError = asIpcError(error);
    res.status(400).json({ ok: false, error: ipcError });
  }
});

// ─── Upload endpoint ───
app.post('/api/upload', requireAuth, upload.single('audio'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ ok: false, error: { code: 'NO_FILE', message: 'No audio file uploaded' } });
    return;
  }

  try {
    // Multer decodes multipart filenames as Latin-1; fix to UTF-8
    let originalName = req.file.originalname;
    try { originalName = Buffer.from(originalName, 'latin1').toString('utf8'); } catch { }

    const ext = path.extname(originalName) || '.bin';
    const managedName = `${Date.now()}_${crypto.randomUUID()}${ext}`;
    const managedAudioPath = path.join(managedPaths.imports, managedName);
    await fsp.rename(req.file.path, managedAudioPath);

    // Prefer binding subject before job starts, so subject-level merge/html can run in the same pipeline pass.
    const subjectIdRaw = String(req.body?.subjectId || '').trim();
    const subjectId = subjectIdRaw || null;
    if (subjectId && !appDb.getSubject(subjectId)) {
      throw new ControlledError('SUBJECT_NOT_FOUND', 'Selected subject was not found');
    }

    const result = await ingestManagedAudio({
      managedAudioPath,
      sourceType: 'imported_file',
      originalFileName: originalName,
      originalFilePath: null,
      subjectId,
      db: appDb,
      maxLectureSeconds: MAX_LECTURE_SECONDS,
      queue: mergeQueue,
      cleanupOnError: true
    });

    res.json({
      ok: true,
      recordingId: result.recordingId,
      jobId: result.normalizationStatus === 'queued' ? result.recordingId : null,
      fileName: result.originalFilename,
      durationSec: result.durationSec,
      warning: result.warning || null
    });
  } catch (error) {
    // Cleanup uploaded file on error
    if (req.file?.path) {
      await fsp.unlink(req.file.path).catch(() => { });
    }
    if (error instanceof ControlledError) {
      res.status(400).json({ ok: false, error: asIpcError(error) });
      return;
    }
    process.stderr.write(`[upload] error: ${error.message}\n`);
    res.status(500).json({ ok: false, error: { code: 'UPLOAD_FAILED', message: 'Failed to process uploaded file' } });
  }
});

// ─── Job status endpoint (for polling) ───
app.get('/api/jobs/:recordingId/status', requireAuth, (req, res) => {
  const recordingId = sanitizeRecordingId(req.params.recordingId);

  if (!fs.existsSync(conspectorDbPath)) {
    res.status(404).json({ ok: false, error: { code: 'DB_NOT_FOUND', message: 'Database not found' } });
    return;
  }

  try {
    const recording = appDb.getRecording(recordingId);
    if (!recording) {
      res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Recording not found' } });
      return;
    }

    // Get latest job for this recording
    const conspectorDb2 = new DatabaseSync(conspectorDbPath, { readOnly: true });
    try {
      const job = conspectorDb2.prepare(`
        SELECT id, stage, status, warning, error_code, error_message, updated_at
        FROM merge_jobs
        WHERE recording_id = ?
        ORDER BY created_at DESC
        LIMIT 1
      `).get(recordingId);

      const htmlAvailable = fs.existsSync(path.join(dataRoot, 'html', `${recordingId}.html`));

      res.json({
        ok: true,
        recordingId,
        job: job ? {
          jobId: job.id,
          stage: job.stage,
          status: job.status,
          warning: job.warning || null,
          errorCode: job.error_code || null,
          errorMessage: job.error_message || null,
          updatedAt: job.updated_at
        } : null,
        htmlAvailable
      });
    } finally {
      conspectorDb2.close();
    }
  } catch (error) {
    process.stderr.write(`[jobs/status] error: ${error.message}\n`);
    res.status(500).json({ ok: false, error: { code: 'STATUS_ERROR', message: 'Could not fetch job status' } });
  }
});

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    platform: process.platform,
    dataRoot,
    notionMode: process.env.CONSPECTOR_NOTION_MODE === 'real' ? 'real' : 'off'
  });
});

app.post('/api/auth/register', (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || '');

  if (!isValidEmail(email)) {
    res.status(400).json({ error: 'INVALID_EMAIL', message: 'Invalid email format' });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: 'INVALID_PASSWORD', message: 'Password must be at least 8 characters' });
    return;
  }

  const existing = getUserByEmailStmt.get(email);
  if (existing) {
    res.status(409).json({ error: 'EMAIL_EXISTS', message: 'User with this email already exists' });
    return;
  }

  const userId = `usr_${crypto.randomUUID()}`;
  const role = resolveRoleByEmail(email);
  insertUserStmt.run(userId, email, hashPassword(password), role, nowIso());
  const user = getUserByIdStmt.get(userId);
  const token = createSessionForUser(userId);

  res.status(201).json({
    ok: true,
    token,
    user: toSafeUser(user)
  });
});

app.post('/api/auth/login', (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || '');
  const user = getUserByEmailStmt.get(email);
  if (!user || !verifyPassword(password, user.password_hash)) {
    res.status(401).json({ error: 'INVALID_CREDENTIALS', message: 'Email or password is invalid' });
    return;
  }

  const synced = maybeSyncAdminRole(user);
  const token = createSessionForUser(user.id);
  res.json({
    ok: true,
    token,
    user: toSafeUser(synced)
  });
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  deleteSessionStmt.run(req.authToken);
  res.json({ ok: true });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ ok: true, user: toSafeUser(req.user) });
});

app.get('/api/conspects', requireAuth, (_req, res) => {
  res.json({
    ok: true,
    items: listConspects()
  });
});

app.get('/api/conspects/:recordingId/html', requireAuth, (req, res) => {
  try {
    const recordingId = sanitizeRecordingId(req.params.recordingId);
    const htmlPath = path.resolve(dataRoot, 'html', `${recordingId}.html`);
    if (!fs.existsSync(htmlPath)) {
      return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'HTML result not found' } });
    }
    const content = fs.readFileSync(htmlPath, 'utf8');
    res.type('text/html').send(content);
  } catch (error) {
    if (!res.headersSent) {
      const ipcError = asIpcError(error);
      res.status(error instanceof ControlledError ? 400 : 500).json({ ok: false, error: ipcError });
    }
  }
});

app.get('/api/conspects/:recordingId/md', requireAuth, (req, res) => {
  try {
    const recordingId = sanitizeRecordingId(req.params.recordingId);
    const mdPath = path.resolve(dataRoot, 'merged', `${recordingId}.md`);
    if (!fs.existsSync(mdPath)) {
      return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Markdown result not found' } });
    }
    const content = fs.readFileSync(mdPath, 'utf8');
    res.type('text/markdown').send(content);
  } catch (error) {
    if (!res.headersSent) {
      const ipcError = asIpcError(error);
      res.status(error instanceof ControlledError ? 400 : 500).json({ ok: false, error: ipcError });
    }
  }
});

// ─── Diagnostic: check file existence for a recording ───
app.get('/api/admin/debug-files/:recordingId', requireAuth, requireAdmin, (req, res) => {
  try {
    const recordingId = sanitizeRecordingId(req.params.recordingId);
    const files = {
      html: path.resolve(dataRoot, 'html', `${recordingId}.html`),
      merged: path.resolve(dataRoot, 'merged', `${recordingId}.md`),
      structured: path.resolve(dataRoot, 'structured', `${recordingId}.md`),
      transcript: path.resolve(dataRoot, 'transcripts', `${recordingId}.json`)
    };
    const result = { dataRoot, recordingId, files: {} };
    for (const [key, filePath] of Object.entries(files)) {
      const exists = fs.existsSync(filePath);
      result.files[key] = {
        path: filePath,
        exists,
        size: exists ? fs.statSync(filePath).size : null
      };
    }
    res.json({ ok: true, ...result });
  } catch (error) {
    if (!res.headersSent) {
      const ipcError = asIpcError(error);
      res.status(error instanceof ControlledError ? 400 : 500).json({ ok: false, error: ipcError });
    }
  }
});

app.get('/api/admin/users', requireAuth, requireAdmin, (_req, res) => {
  const users = listUsersStmt.all().map((row) => ({
    id: row.id,
    email: row.email,
    role: row.role,
    createdAt: row.created_at
  }));
  res.json({ ok: true, users });
});

// ─── Delete a recording ───
app.delete('/api/conspects/:recordingId', requireAuth, requireAdmin, async (req, res) => {
  const recordingId = sanitizeRecordingId(req.params.recordingId);
  if (!recordingId) {
    return res.status(400).json({ ok: false, error: 'Invalid recordingId' });
  }

  try {
    const result = appDb.deleteRecording(recordingId);
    if (!result.deleted) {
      return res.status(404).json({ ok: false, error: 'Recording not found' });
    }

    // Best-effort cleanup of associated files
    const filesToDelete = [
      path.join(managedPaths.transcripts, `${recordingId}.json`),
      path.join(managedPaths.transcripts, `${recordingId}.json.stt.log`),
      path.join(managedPaths.structured, `${recordingId}.md`),
      path.join(managedPaths.structured, `${recordingId}.md.gemini.log`),
      path.join(managedPaths.merged, `${recordingId}.md`),
      path.join(managedPaths.html, `${recordingId}.html`)
    ];
    for (const fp of filesToDelete) {
      await fsp.unlink(fp).catch(() => { });
    }

    res.json({ ok: true, recordingId });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/api/admin/notion-writeback', requireAuth, requireAdmin, async (req, res) => {
  const recordingId = sanitizeRecordingId(req.body?.recordingId);
  const pageTitle = String(req.body?.pageTitle || '').trim();

  if (process.env.CONSPECTOR_NOTION_MODE !== 'real') {
    res.status(400).json({
      ok: false,
      error: {
        code: 'NOTION_DISABLED',
        message: 'Notion writeback отключён. Установите CONSPECTOR_NOTION_MODE=real в .env на сервере.'
      }
    });
    return;
  }

  if (!process.env.NOTION_TOKEN) {
    res.status(400).json({
      ok: false,
      error: {
        code: 'NOTION_TOKEN_MISSING',
        message: 'NOTION_TOKEN не настроен в .env на сервере.'
      }
    });
    return;
  }

  if (!pageTitle) {
    res.status(400).json({ ok: false, error: { code: 'NOTION_PAGE_TITLE_REQUIRED', message: 'Page title is required' } });
    return;
  }

  if (!fs.existsSync(conspectorDbPath)) {
    res.status(404).json({ ok: false, error: { code: 'CONSPECTOR_DB_NOT_FOUND', message: 'Conspector database not found' } });
    return;
  }

  const conspectorDb = new DatabaseSync(conspectorDbPath, { readOnly: true });
  try {
    const recording = conspectorDb
      .prepare(
        `
        SELECT
          id,
          source_type,
          original_file_name,
          original_file_path,
          managed_audio_path,
          normalized_audio_path,
          audio_sha256,
          duration_sec,
          created_at,
          updated_at
        FROM recordings
        WHERE id = ?
      `
      )
      .get(recordingId);

    if (!recording) {
      res.status(404).json({ ok: false, error: { code: 'RECORDING_NOT_FOUND', message: `Recording not found: ${recordingId}` } });
      return;
    }

    const mergedPath = path.join(dataRoot, 'merged', `${recordingId}.md`);
    if (!fs.existsSync(mergedPath)) {
      res.status(404).json({ ok: false, error: { code: 'MERGED_NOTE_NOT_FOUND', message: `Merged markdown not found: ${mergedPath}` } });
      return;
    }

    const notionConfig = {
      mode: process.env.CONSPECTOR_NOTION_MODE === 'real' ? 'real' : 'off',
      token: process.env.NOTION_TOKEN || '',
      pageId: process.env.CONSPECTOR_NOTION_PAGE_ID || '',
      pageTitle,
      rootPageId: process.env.CONSPECTOR_NOTION_ROOT_PAGE_ID || '',
      mergeWithExisting: parseBoolean(process.env.CONSPECTOR_NOTION_MERGE_WITH_EXISTING, true)
    };

    // Determine LLM provider (gemini or codex) from pipeline config
    const llmProvider = runtimeConfig.llm?.provider || 'codex';
    const llmConfigKey = getLlmConfigKey(llmProvider);
    const llmConfig = runtimeConfig[llmConfigKey];
    const llmMergeFromMarkdown = getMergeFromMarkdownWorker(llmProvider);

    const backupsDir = path.join(dataRoot, 'backups');
    const result = await writeMergedToNotion({
      mergedPath,
      recording,
      backupsDir,
      notionConfig,
      llmMergeFromMarkdown,
      llmConfig
    });

    if (result?.status === 'skipped') {
      res.status(400).json({
        ok: false,
        error: {
          code: 'NOTION_WRITEBACK_SKIPPED',
          message: result.warning || 'Notion writeback skipped',
          details: {
            targetPageTitleRequested: result.targetPageTitleRequested || pageTitle,
            logPath: result.logPath || ''
          }
        }
      });
      return;
    }

    res.json({ ok: true, ...result });
  } catch (error) {
    const ipcError = asIpcError(error);
    res.status(400).json({ ok: false, error: ipcError });
  } finally {
    conspectorDb.close();
  }
});

// ─── Git integration: sync conspects to repo ───

function sanitizeFolderName(name) {
  return name.replace(/[/\\:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();
}

app.post('/api/admin/sync-conspects-to-repo', requireAuth, requireAdmin, async (req, res) => {
  try {
    const subjects = appDb.listSubjects();
    if (subjects.length === 0) {
      return res.status(400).json({ ok: false, error: { code: 'NO_SUBJECTS', message: 'No subjects found' } });
    }

    const conspectsRoot = path.join(projectRoot, 'conspects');
    await fsp.mkdir(conspectsRoot, { recursive: true });

    const synced = [];
    for (const subj of subjects) {
      const subjectDir = path.join(managedPaths.subjects, subj.id);
      const folderName = sanitizeFolderName(subj.name);
      const targetDir = path.join(conspectsRoot, folderName);
      await fsp.mkdir(targetDir, { recursive: true });

      const files = ['merged.md', 'conspect.html'];
      let copied = 0;
      for (const file of files) {
        const src = path.join(subjectDir, file);
        if (fs.existsSync(src)) {
          await fsp.copyFile(src, path.join(targetDir, file));
          copied++;
        }
      }
      if (copied > 0) {
        synced.push({ name: subj.name, folder: folderName, files: copied });
      }
    }

    if (synced.length === 0) {
      return res.json({ ok: true, message: 'No conspect files found to sync', synced: [] });
    }

    // Git add + commit
    const commitMsg = req.body?.message || `conspects: sync ${synced.length} subject(s)`;
    try {
      execSync('git add conspects/', { cwd: projectRoot, stdio: 'pipe' });
      execSync(`git commit -m ${JSON.stringify(commitMsg)}`, { cwd: projectRoot, stdio: 'pipe' });
    } catch (gitErr) {
      // git commit returns non-zero if nothing to commit
      const stderr = gitErr.stderr?.toString() || '';
      if (!stderr.includes('nothing to commit') && !gitErr.stdout?.toString().includes('nothing to commit')) {
        throw gitErr;
      }
    }

    res.json({ ok: true, synced, commitMessage: commitMsg });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Sync failed';
    res.status(500).json({ ok: false, error: { code: 'SYNC_FAILED', message } });
  }
});

app.post('/api/admin/apply-from-repo', requireAuth, requireAdmin, async (req, res) => {
  try {
    const conspectsRoot = path.join(projectRoot, 'conspects');
    if (!fs.existsSync(conspectsRoot)) {
      return res.status(404).json({ ok: false, error: { code: 'NO_CONSPECTS_DIR', message: 'conspects/ directory not found' } });
    }

    const subjects = appDb.listSubjects();
    const nameToSubject = new Map();
    for (const s of subjects) {
      nameToSubject.set(sanitizeFolderName(s.name), s);
    }

    const entries = await fsp.readdir(conspectsRoot, { withFileTypes: true });
    const applied = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const subj = nameToSubject.get(entry.name);
      if (!subj) continue;

      const repoDir = path.join(conspectsRoot, entry.name);
      const subjectDir = path.join(managedPaths.subjects, subj.id);
      await fsp.mkdir(subjectDir, { recursive: true });

      const repoMd = path.join(repoDir, 'merged.md');
      if (fs.existsSync(repoMd)) {
        await fsp.copyFile(repoMd, path.join(subjectDir, 'merged.md'));

        // Re-render HTML
        try {
          const { renderHtmlFromMarkdown } = await import('../src/main/workers/htmlWorker.js');
          await renderHtmlFromMarkdown({
            mergedPath: path.join(subjectDir, 'merged.md'),
            htmlPath: path.join(subjectDir, 'conspect.html'),
            title: subj.name
          });
        } catch { /* HTML render optional */ }

        applied.push({ name: subj.name, folder: entry.name });
      }
    }

    res.json({ ok: true, applied });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Apply failed';
    res.status(500).json({ ok: false, error: { code: 'APPLY_FAILED', message } });
  }
});

app.use((error, _req, res, _next) => {
  if (error instanceof ControlledError) {
    res.status(400).json({ ok: false, error: asIpcError(error) });
    return;
  }

  const message = error instanceof Error ? error.message : 'Unknown web server error';
  process.stderr.write(`[web] unhandled error: ${message}\n`);
  res.status(500).json({
    ok: false,
    error: {
      code: 'WEB_INTERNAL_ERROR',
      message: 'Unexpected server error'
    }
  });
});

app.use(express.static(publicDir));
app.get(/^\/(?!api\/).*/, (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.listen(PORT, () => {
  process.stdout.write(
    `[web] ABI Conspector web started on http://localhost:${PORT}\n` +
    `[web] platform=${process.platform}, dataRoot=${dataRoot}\n`
  );
});
