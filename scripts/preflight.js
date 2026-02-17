#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function run(command, args) {
  return spawnSync(command, args, { encoding: 'utf8' });
}

function pass(msg) {
  process.stdout.write(`PASS ${msg}\n`);
}

function warn(msg) {
  process.stdout.write(`WARN ${msg}\n`);
}

function fail(msg) {
  process.stderr.write(`FAIL ${msg}\n`);
}

function firstLine(result) {
  return (result.stdout || result.stderr || '').split('\n').find(Boolean) || 'ok';
}

function checkBinary(name, required, args = ['--version']) {
  const result = run(name, args);
  if (result.error || result.status !== 0) {
    if (required) {
      fail(`${name} is missing or not working`);
      return false;
    }
    warn(`${name} not found`);
    return true;
  }
  pass(`${name}: ${firstLine(result)}`);
  return true;
}

const sttMode = process.env.CONSPECTOR_STT_MODE === 'mock' ? 'mock' : 'real';
const sttPrimary = ['groq', 'whispercpp'].includes(String(process.env.CONSPECTOR_STT_PRIMARY || '').toLowerCase())
  ? String(process.env.CONSPECTOR_STT_PRIMARY || '').toLowerCase()
  : 'groq';
const sttFallback = ['whispercpp', 'none'].includes(String(process.env.CONSPECTOR_STT_FALLBACK || '').toLowerCase())
  ? String(process.env.CONSPECTOR_STT_FALLBACK || '').toLowerCase()
  : 'whispercpp';
const codexMode = process.env.CONSPECTOR_CODEX_MODE === 'mock' ? 'mock' : 'real';
const notionMode = process.env.CONSPECTOR_NOTION_MODE === 'real' ? 'real' : 'off';
const groqApiKey = process.env.CONSPECTOR_GROQ_API_KEY || process.env.GROQ_API_KEY || '';
const whisperCppBin = process.env.CONSPECTOR_WHISPERCPP_BIN || 'whisper-cli';
const whisperCppModelPath =
  process.env.CONSPECTOR_WHISPERCPP_MODEL_PATH || path.join(process.cwd(), 'models', 'ggml-base.bin');
const strict = process.env.CONSPECTOR_PREFLIGHT_STRICT
  ? !['0', 'false', 'no', 'off'].includes(String(process.env.CONSPECTOR_PREFLIGHT_STRICT).toLowerCase())
  : false;

const [major] = process.versions.node.split('.').map(Number);
if (!Number.isFinite(major) || major < 24) {
  fail(`Node.js >=24 required. Current: ${process.versions.node}`);
  process.exit(1);
}
pass(`Node.js ${process.versions.node}`);

let ok = true;

function markIssue(message) {
  if (strict) {
    fail(message);
    ok = false;
    return;
  }
  warn(`${message} (soft)`);
}

ok = checkBinary('ffmpeg', strict, ['-version']) && ok;
ok = checkBinary('ffprobe', strict, ['-version']) && ok;

if (sttMode === 'real') {
  pass(`STT primary=${sttPrimary}, fallback=${sttFallback}`);

  const requiresGroq = sttPrimary === 'groq';
  if (requiresGroq) {
    if (!groqApiKey) {
      markIssue('CONSPECTOR_GROQ_API_KEY (or GROQ_API_KEY) is required for CONSPECTOR_STT_PRIMARY=groq');
    } else {
      pass('Groq API key is set');
    }
  }

  const requiresWhisperCpp = sttPrimary === 'whispercpp' || sttFallback === 'whispercpp';
  if (requiresWhisperCpp) {
    ok = checkBinary(whisperCppBin, strict, ['--help']) && ok;
    if (!fs.existsSync(whisperCppModelPath)) {
      markIssue(`whisper.cpp model not found: ${whisperCppModelPath}`);
    } else {
      pass(`whisper.cpp model found: ${whisperCppModelPath}`);
    }
  }
} else {
  warn('CONSPECTOR_STT_MODE=mock, real STT worker is disabled');
}

if (codexMode === 'real') {
  ok = checkBinary('codex', true, ['--version']) && ok;
  const codexEffort = String(process.env.CONSPECTOR_CODEX_EFFORT || 'medium').toLowerCase();
  if (!['low', 'medium', 'high'].includes(codexEffort)) {
    warn(`CONSPECTOR_CODEX_EFFORT should be low|medium|high (current: ${codexEffort})`);
  } else {
    pass(`Codex reasoning effort: ${codexEffort}`);
  }

  const codexFullAuto = process.env.CONSPECTOR_CODEX_FULL_AUTO
    ? !['0', 'false', 'no', 'off'].includes(String(process.env.CONSPECTOR_CODEX_FULL_AUTO).toLowerCase())
    : true;
  pass(`Codex full-auto: ${codexFullAuto ? 'enabled' : 'disabled'}`);

  const codexWorkdir = process.env.CONSPECTOR_CODEX_WORKDIR || process.cwd();
  const agentsPath = path.join(codexWorkdir, 'AGENTS.md');
  const skillsPath = path.join(codexWorkdir, '.agents', 'skills');

  if (fs.existsSync(agentsPath)) {
    pass(`Codex project instructions found: ${agentsPath}`);
  } else {
    warn(`AGENTS.md not found in CONSPECTOR_CODEX_WORKDIR (${codexWorkdir})`);
  }

  if (fs.existsSync(skillsPath)) {
    pass(`Codex skills directory found: ${skillsPath}`);
  } else {
    warn(`.agents/skills not found in CONSPECTOR_CODEX_WORKDIR (${codexWorkdir})`);
  }
} else {
  warn('CONSPECTOR_CODEX_MODE=mock, codex structuring/merge is disabled');
}

if (notionMode === 'real') {
  if (!process.env.NOTION_TOKEN) {
    markIssue('NOTION_TOKEN is required for CONSPECTOR_NOTION_MODE=real');
  } else {
    pass('NOTION_TOKEN is set');
  }

  if (
    !process.env.CONSPECTOR_NOTION_PAGE_ID &&
    !process.env.CONSPECTOR_NOTION_PAGE_TITLE &&
    !process.env.CONSPECTOR_NOTION_ROOT_PAGE_ID
  ) {
    markIssue(
      'Set CONSPECTOR_NOTION_PAGE_ID or CONSPECTOR_NOTION_PAGE_TITLE (or CONSPECTOR_NOTION_ROOT_PAGE_ID for nested lookup) for Notion writeback'
    );
  } else {
    pass('Notion page target is configured');
  }
} else {
  warn('CONSPECTOR_NOTION_MODE=off, Notion writeback disabled');
}

if (!ok) {
  process.exit(1);
}

pass('Preflight completed');
