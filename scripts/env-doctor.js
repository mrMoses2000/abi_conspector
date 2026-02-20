#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const rootDir = process.cwd();
const envPath = process.env.CONSPECTOR_ENV_FILE || path.join(rootDir, '.env');
const args = new Set(process.argv.slice(2));
const shouldWrite = args.has('--write');

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);
const TEMPLATE_MARKERS = ['/Users/you/abi_conspector', '/home/you/abi_conspector', '/path/to/abi_conspector'];

const PATH_DEFAULTS = {
  CONSPECTOR_WHISPERCPP_BIN: path.join(rootDir, 'tools', 'whisper.cpp', 'build', 'bin', 'whisper-cli'),
  CONSPECTOR_WHISPERCPP_MODEL_PATH: path.join(rootDir, 'models', 'ggml-base.bin'),
  CONSPECTOR_STT_PYTHON: path.join(rootDir, '.venv-stt', 'bin', 'python'),
  CONSPECTOR_STT_SCRIPT: path.join(rootDir, 'scripts', 'run_stt_diarization.py'),
  CONSPECTOR_CODEX_WORKDIR: rootDir,
  CONSPECTOR_GEMINI_WORKDIR: rootDir
};

function pass(text) {
  process.stdout.write(`PASS ${text}\n`);
}

function warn(text) {
  process.stdout.write(`WARN ${text}\n`);
}

function fail(text) {
  process.stderr.write(`FAIL ${text}\n`);
}

function normalizeBoolean(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (TRUE_VALUES.has(raw)) {
    return true;
  }
  if (FALSE_VALUES.has(raw)) {
    return false;
  }
  return null;
}

function parseIntSafe(value) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseEnv(rawText) {
  const env = {};
  const lines = String(rawText || '').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) {
      continue;
    }
    const key = match[1];
    let value = match[2] ?? '';
    value = value.trim();

    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    value = value.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    env[key] = value;
  }
  return env;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatEnvValue(value) {
  const normalized = String(value ?? '').replaceAll('\n', ' ');
  if (/\s|#/.test(normalized)) {
    return `"${normalized.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
  }
  return normalized;
}

function applyUpdates(rawText, updates) {
  let lines = String(rawText || '').split(/\r?\n/);
  for (const [key, value] of updates.entries()) {
    const lineValue = `${key}=${formatEnvValue(value)}`;
    const re = new RegExp(`^\\s*${escapeRegExp(key)}=`);
    let found = false;
    lines = lines.map((line) => {
      if (re.test(line)) {
        found = true;
        return lineValue;
      }
      return line;
    });
    if (!found) {
      lines.push(lineValue);
    }
  }
  return `${lines.join('\n').replace(/\n+$/g, '')}\n`;
}

function normalizeProjectPath(value) {
  const input = String(value || '').trim();
  if (!input) {
    return input;
  }

  if (input === '/path/to/workdir') {
    return rootDir;
  }
  if (input.startsWith('~/')) {
    return path.join(os.homedir(), input.slice(2));
  }
  if (input.startsWith('$HOME/')) {
    return path.join(os.homedir(), input.slice('$HOME/'.length));
  }
  if (input.includes('/abi_conspector')) {
    const suffix = input.split('/abi_conspector')[1] || '';
    return `${rootDir}${suffix}`;
  }
  for (const marker of TEMPLATE_MARKERS) {
    if (input.includes(marker)) {
      return input.replace(marker, rootDir);
    }
  }
  if (!path.isAbsolute(input)) {
    return path.resolve(rootDir, input);
  }
  return input;
}

function validateEnum(issues, updates, env, key, allowed, fallback) {
  const current = String(env[key] || '').trim().toLowerCase();
  if (!current) {
    issues.push({
      level: 'warn',
      key,
      message: 'is empty',
      suggestion: `${key}=${fallback}`,
      autofix: fallback
    });
    return fallback;
  }
  if (!allowed.includes(current)) {
    issues.push({
      level: 'fail',
      key,
      message: `must be one of: ${allowed.join(', ')}`,
      suggestion: `${key}=${fallback}`,
      autofix: fallback
    });
    return fallback;
  }
  return current;
}

function validatePositiveInt(issues, env, key, fallback, min = 1) {
  const current = parseIntSafe(env[key]);
  if (current === null || current < min) {
    issues.push({
      level: 'warn',
      key,
      message: `must be an integer >= ${min}`,
      suggestion: `${key}=${fallback}`,
      autofix: String(fallback)
    });
    return fallback;
  }
  return current;
}

function validateBooleans(issues, env, keys) {
  for (const key of keys) {
    if (!(key in env)) {
      continue;
    }
    const parsed = normalizeBoolean(env[key]);
    if (parsed === null) {
      issues.push({
        level: 'warn',
        key,
        message: 'must be a boolean-like value (true/false/1/0/yes/no/on/off)',
        suggestion: `${key}=true|false`
      });
    }
  }
}

function checkTrimmedSecrets(issues, env, keys) {
  for (const key of keys) {
    const current = env[key];
    if (!current) {
      continue;
    }
    const trimmed = String(current).trim();
    if (trimmed !== current) {
      issues.push({
        level: 'warn',
        key,
        message: 'contains leading/trailing spaces',
        suggestion: `${key}=${trimmed}`,
        autofix: trimmed
      });
    }
  }
}

function checkPathKeys(issues, env) {
  for (const [key, fallback] of Object.entries(PATH_DEFAULTS)) {
    const currentRaw = env[key] ?? '';
    const current = String(currentRaw).trim();
    const normalized = normalizeProjectPath(current || fallback);

    if (!current) {
      issues.push({
        level: 'warn',
        key,
        message: 'is empty',
        suggestion: `${key}=${normalized}`,
        autofix: normalized
      });
      continue;
    }

    if (normalized !== current) {
      issues.push({
        level: 'warn',
        key,
        message: 'contains template/relative path that should point to current project root',
        suggestion: `${key}=${normalized}`,
        autofix: normalized
      });
    }

    if (!fs.existsSync(normalized)) {
      issues.push({
        level: 'warn',
        key,
        message: `path does not exist: ${normalized}`,
        suggestion: `${key}=<existing absolute path>`
      });
    }
  }
}

function main() {
  if (!fs.existsSync(envPath)) {
    fail(`.env file not found: ${envPath}`);
    fail('Run ./run.sh --configure-env first.');
    process.exit(1);
  }

  const rawText = fs.readFileSync(envPath, 'utf8');
  const env = parseEnv(rawText);
  const issues = [];
  const updates = new Map();

  const sttMode = validateEnum(issues, updates, env, 'CONSPECTOR_STT_MODE', ['real', 'mock'], 'real');
  const sttPrimary = validateEnum(issues, updates, env, 'CONSPECTOR_STT_PRIMARY', ['groq', 'whispercpp'], 'groq');
  const sttFallback = validateEnum(issues, updates, env, 'CONSPECTOR_STT_FALLBACK', ['whispercpp', 'none'], 'whispercpp');
  const codexMode = validateEnum(issues, updates, env, 'CONSPECTOR_CODEX_MODE', ['real', 'mock'], 'real');
  const llmProvider = validateEnum(issues, updates, env, 'CONSPECTOR_LLM_PROVIDER', ['codex', 'gemini'], 'codex');
  const geminiMode = validateEnum(issues, updates, env, 'CONSPECTOR_GEMINI_MODE', ['real', 'mock'], 'real');
  const notionMode = validateEnum(issues, updates, env, 'CONSPECTOR_NOTION_MODE', ['off', 'real'], 'off');

  validatePositiveInt(issues, env, 'CONSPECTOR_STT_TIMEOUT_SEC', 1800, 1);
  validatePositiveInt(issues, env, 'CONSPECTOR_GROQ_MAX_FILE_MB', 25, 1);
  validatePositiveInt(issues, env, 'CONSPECTOR_GROQ_CHUNK_MIN', 18, 1);
  validatePositiveInt(issues, env, 'CONSPECTOR_WHISPERCPP_THREADS', 2, 1);
  validatePositiveInt(issues, env, 'CONSPECTOR_CODEX_TIMEOUT_SEC', 600, 1);
  validatePositiveInt(issues, env, 'CONSPECTOR_GEMINI_TIMEOUT_SEC', 600, 1);
  validatePositiveInt(issues, env, 'CONSPECTOR_WEB_SESSION_DAYS', 30, 1);
  validatePositiveInt(issues, env, 'CONSPECTOR_WEB_PORT', 8787, 1);

  validateBooleans(issues, env, [
    'CONSPECTOR_CODEX_FULL_AUTO',
    'CONSPECTOR_CODEX_FALLBACK_TO_MOCK',
    'CONSPECTOR_STT_FALLBACK_TO_MOCK',
    'CONSPECTOR_NOTION_MERGE_WITH_EXISTING',
    'CONSPECTOR_NOTION_SOFT_FAIL',
    'CONSPECTOR_HTML_SOFT_FAIL',
    'CONSPECTOR_PREFLIGHT_STRICT',
    'CONSPECTOR_GEMINI_SANDBOX'
  ]);

  checkTrimmedSecrets(issues, env, ['CONSPECTOR_GROQ_API_KEY', 'GROQ_API_KEY', 'NOTION_TOKEN']);
  checkPathKeys(issues, env);

  if (sttMode === 'real' && sttPrimary === 'groq') {
    const groqKey = String(env.CONSPECTOR_GROQ_API_KEY || env.GROQ_API_KEY || '').trim();
    if (!groqKey) {
      issues.push({
        level: 'fail',
        key: 'CONSPECTOR_GROQ_API_KEY',
        message: 'is required when CONSPECTOR_STT_PRIMARY=groq and STT mode is real',
        suggestion: 'CONSPECTOR_GROQ_API_KEY=gsk_...'
      });
    } else if (!groqKey.startsWith('gsk_')) {
      issues.push({
        level: 'warn',
        key: 'CONSPECTOR_GROQ_API_KEY',
        message: 'does not look like a Groq key (expected prefix gsk_)',
        suggestion: 'CONSPECTOR_GROQ_API_KEY=gsk_...'
      });
    }
  }

  if (sttMode === 'real' && (sttPrimary === 'whispercpp' || sttFallback === 'whispercpp')) {
    const binPath = normalizeProjectPath(env.CONSPECTOR_WHISPERCPP_BIN || PATH_DEFAULTS.CONSPECTOR_WHISPERCPP_BIN);
    const modelPath = normalizeProjectPath(
      env.CONSPECTOR_WHISPERCPP_MODEL_PATH || PATH_DEFAULTS.CONSPECTOR_WHISPERCPP_MODEL_PATH
    );
    if (!fs.existsSync(binPath)) {
      issues.push({
        level: 'fail',
        key: 'CONSPECTOR_WHISPERCPP_BIN',
        message: `binary not found: ${binPath}`,
        suggestion: `CONSPECTOR_WHISPERCPP_BIN=${PATH_DEFAULTS.CONSPECTOR_WHISPERCPP_BIN}`
      });
    }
    if (!fs.existsSync(modelPath)) {
      issues.push({
        level: 'fail',
        key: 'CONSPECTOR_WHISPERCPP_MODEL_PATH',
        message: `model not found: ${modelPath}`,
        suggestion: `CONSPECTOR_WHISPERCPP_MODEL_PATH=${PATH_DEFAULTS.CONSPECTOR_WHISPERCPP_MODEL_PATH}`
      });
    }
  }

  if (codexMode === 'real') {
    const workdir = normalizeProjectPath(env.CONSPECTOR_CODEX_WORKDIR || PATH_DEFAULTS.CONSPECTOR_CODEX_WORKDIR);
    if (!fs.existsSync(workdir)) {
      issues.push({
        level: 'fail',
        key: 'CONSPECTOR_CODEX_WORKDIR',
        message: `directory not found: ${workdir}`,
        suggestion: `CONSPECTOR_CODEX_WORKDIR=${rootDir}`,
        autofix: rootDir
      });
    } else {
      if (!fs.existsSync(path.join(workdir, 'AGENTS.md'))) {
        issues.push({
          level: 'warn',
          key: 'CONSPECTOR_CODEX_WORKDIR',
          message: `AGENTS.md not found in ${workdir}`,
          suggestion: `CONSPECTOR_CODEX_WORKDIR=${rootDir}`,
          autofix: rootDir
        });
      }
      if (!fs.existsSync(path.join(workdir, '.agents', 'skills'))) {
        issues.push({
          level: 'warn',
          key: 'CONSPECTOR_CODEX_WORKDIR',
          message: `.agents/skills not found in ${workdir}`,
          suggestion: `CONSPECTOR_CODEX_WORKDIR=${rootDir}`,
          autofix: rootDir
        });
      }
    }
  }

  if (llmProvider === 'gemini' && geminiMode === 'real') {
    const workdir = normalizeProjectPath(env.CONSPECTOR_GEMINI_WORKDIR || PATH_DEFAULTS.CONSPECTOR_GEMINI_WORKDIR);
    if (!fs.existsSync(workdir)) {
      issues.push({
        level: 'fail',
        key: 'CONSPECTOR_GEMINI_WORKDIR',
        message: `directory not found: ${workdir}`,
        suggestion: `CONSPECTOR_GEMINI_WORKDIR=${rootDir}`,
        autofix: rootDir
      });
    }
  }

  if (notionMode === 'real') {
    const token = String(env.NOTION_TOKEN || '').trim();
    if (!token) {
      issues.push({
        level: 'fail',
        key: 'NOTION_TOKEN',
        message: 'is required when CONSPECTOR_NOTION_MODE=real',
        suggestion: 'NOTION_TOKEN=ntn_...'
      });
    }
    const hasTarget =
      String(env.CONSPECTOR_NOTION_PAGE_ID || '').trim() ||
      String(env.CONSPECTOR_NOTION_PAGE_TITLE || '').trim() ||
      String(env.CONSPECTOR_NOTION_ROOT_PAGE_ID || '').trim();
    if (!hasTarget) {
      issues.push({
        level: 'fail',
        key: 'CONSPECTOR_NOTION_ROOT_PAGE_ID',
        message: 'page target is not configured',
        suggestion: 'CONSPECTOR_NOTION_ROOT_PAGE_ID=<notion_page_id>'
      });
    }
  }

  for (const issue of issues) {
    if (issue.autofix !== undefined) {
      updates.set(issue.key, issue.autofix);
    }
  }

  pass(`Project root detected: ${rootDir}`);
  pass(`Environment file: ${envPath}`);

  if (issues.length === 0) {
    pass('No issues found. Environment variables look good.');
    process.exit(0);
  }

  let failCount = 0;
  let warnCount = 0;
  for (const issue of issues) {
    const message = `[${issue.key}] ${issue.message}`;
    if (issue.level === 'fail') {
      failCount += 1;
      fail(message);
    } else {
      warnCount += 1;
      warn(message);
    }
    if (issue.suggestion) {
      process.stdout.write(`  SUGGEST: ${issue.suggestion}\n`);
    }
  }

  if (shouldWrite && updates.size > 0) {
    const updatedRaw = applyUpdates(rawText, updates);
    fs.writeFileSync(envPath, updatedRaw, 'utf8');
    pass(`Auto-fixed ${updates.size} variable(s) in ${envPath}`);
  } else if (!shouldWrite) {
    warn('Run with --write to apply safe auto-fixes for detected placeholders/defaults.');
  }

  process.stdout.write(`Summary: fail=${failCount}, warn=${warnCount}\n`);
  if (failCount > 0) {
    process.exit(1);
  }
}

main();
