import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCodexExecArgs, normalizeReasoningEffort } from '../src/main/workers/codexWorker.js';

test('normalizeReasoningEffort keeps supported values', () => {
  assert.equal(normalizeReasoningEffort('low'), 'low');
  assert.equal(normalizeReasoningEffort('medium'), 'medium');
  assert.equal(normalizeReasoningEffort('high'), 'high');
});

test('normalizeReasoningEffort falls back to medium', () => {
  assert.equal(normalizeReasoningEffort(''), 'medium');
  assert.equal(normalizeReasoningEffort('ultra'), 'medium');
});

test('buildCodexExecArgs mirrors full-auto + effort style', () => {
  const args = buildCodexExecArgs(
    {
      workdir: '/tmp/work',
      model: 'gpt-5.3-codex',
      fullAuto: true,
      reasoningEffort: 'high'
    },
    '/tmp/out.md'
  );

  assert.deepEqual(args, [
    'exec',
    '--skip-git-repo-check',
    '--output-last-message',
    '/tmp/out.md',
    '--cd',
    '/tmp/work',
    '--full-auto',
    '-m',
    'gpt-5.3-codex',
    '-c',
    'model_reasoning_effort="high"',
    '-'
  ]);
});

test('buildCodexExecArgs can disable full-auto and omits empty model', () => {
  const args = buildCodexExecArgs(
    {
      workdir: '/tmp/work',
      model: '',
      fullAuto: false,
      reasoningEffort: 'bad-value'
    },
    '/tmp/out.md'
  );

  assert.deepEqual(args, [
    'exec',
    '--skip-git-repo-check',
    '--output-last-message',
    '/tmp/out.md',
    '--cd',
    '/tmp/work',
    '-c',
    'model_reasoning_effort="medium"',
    '-'
  ]);
});

