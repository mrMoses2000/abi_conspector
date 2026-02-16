import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNormalizeArgs, buildProbeArgs } from '../src/main/audio/ffmpeg.js';

test('buildProbeArgs includes json output and stream listing', () => {
  const args = buildProbeArgs('/tmp/input.mp3');
  assert.deepEqual(args, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', '/tmp/input.mp3']);
});

test('buildNormalizeArgs creates mono flac conversion command', () => {
  const args = buildNormalizeArgs({
    inputPath: '/tmp/in.mp3',
    outputPath: '/tmp/out.flac',
    sampleRateHz: 16000,
    channels: 1
  });

  assert.deepEqual(args, [
    '-y',
    '-i',
    '/tmp/in.mp3',
    '-vn',
    '-ac',
    '1',
    '-ar',
    '16000',
    '-c:a',
    'flac',
    '/tmp/out.flac'
  ]);
});
