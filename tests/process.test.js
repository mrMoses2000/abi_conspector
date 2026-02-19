import test from 'node:test';
import assert from 'node:assert/strict';
import { runCommand, summarizeProcessFailure } from '../src/main/utils/process.js';

test('runCommand streams stdout/stderr chunks to callbacks', async () => {
  let out = '';
  let err = '';

  await runCommand({
    command: process.execPath,
    args: ['-e', 'process.stdout.write("OUT"); process.stderr.write("ERR");'],
    onStdout: (chunk) => {
      out += chunk;
    },
    onStderr: (chunk) => {
      err += chunk;
    }
  });

  assert.equal(out, 'OUT');
  assert.equal(err, 'ERR');
});

test('summarizeProcessFailure suppresses deprecation warning prelude and keeps actionable tail', () => {
  const stderr = [
    '(node:327394) [DEP0040] DeprecationWarning: The `punycode` module is deprecated.',
    'Use a userland alternative instead.',
    'FatalAuthenticationError: invalid_grant',
    'Please run gemini login'
  ].join('\n');

  const summary = summarizeProcessFailure(stderr, '');
  assert.equal(summary.includes('DeprecationWarning'), false);
  assert.match(summary, /FatalAuthenticationError/);
  assert.match(summary, /gemini login/);
});
