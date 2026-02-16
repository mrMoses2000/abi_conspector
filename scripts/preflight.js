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
const codexMode = process.env.CONSPECTOR_CODEX_MODE === 'mock' ? 'mock' : 'real';
const notionMode = process.env.CONSPECTOR_NOTION_MODE === 'real' ? 'real' : 'off';
const sttPython = process.env.CONSPECTOR_STT_PYTHON || 'python3';
const strict = process.env.CONSPECTOR_PREFLIGHT_STRICT
  ? !['0', 'false', 'no', 'off'].includes(String(process.env.CONSPECTOR_PREFLIGHT_STRICT).toLowerCase())
  : false;
const requireDiarization = process.env.CONSPECTOR_REQUIRE_DIARIZATION
  ? !['0', 'false', 'no', 'off'].includes(String(process.env.CONSPECTOR_REQUIRE_DIARIZATION).toLowerCase())
  : true;

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
  const scriptPath = process.env.CONSPECTOR_STT_SCRIPT || path.join(process.cwd(), 'scripts', 'run_stt_diarization.py');
  if (!fs.existsSync(scriptPath)) {
    markIssue(`STT script not found: ${scriptPath}`);
  } else {
    pass(`STT script found: ${scriptPath}`);
  }

  ok = checkBinary(sttPython, strict, ['--version']) && ok;
  const pyCheck = run(sttPython, ['-c', 'import whisperx; import torch; print("ok")']);
  if (pyCheck.error || pyCheck.status !== 0) {
    markIssue('python deps missing: whisperx/torch are required for CONSPECTOR_STT_MODE=real');
  } else {
    pass('python deps: whisperx + torch detected');
  }

  if (requireDiarization && !process.env.HUGGINGFACE_TOKEN) {
    markIssue('HUGGINGFACE_TOKEN is required when diarization is enabled');
  } else if (requireDiarization) {
    pass('HUGGINGFACE_TOKEN is set');
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
