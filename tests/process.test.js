import test from 'node:test';
import assert from 'node:assert/strict';
import { runCommand } from '../src/main/utils/process.js';

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
