import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMicrophoneRecordArgs, parseDarwinAudioDevices } from '../src/main/audio/microphoneRecorder.js';
import { ControlledError } from '../src/main/utils/errors.js';

test('parseDarwinAudioDevices extracts audio input indexes', () => {
  const text = [
    '[AVFoundation indev @ 0x7fc] AVFoundation video devices:',
    '[AVFoundation indev @ 0x7fc] [0] FaceTime HD Camera',
    '[AVFoundation indev @ 0x7fc] AVFoundation audio devices:',
    '[AVFoundation indev @ 0x7fc] [0] MacBook Pro Microphone',
    '[AVFoundation indev @ 0x7fc] [1] External USB Mic'
  ].join('\n');

  const devices = parseDarwinAudioDevices(text);
  assert.deepEqual(devices, [
    { index: 0, name: 'MacBook Pro Microphone' },
    { index: 1, name: 'External USB Mic' }
  ]);
});

test('buildMicrophoneRecordArgs returns macOS avfoundation command', () => {
  const args = buildMicrophoneRecordArgs({
    platform: 'darwin',
    outputPath: '/tmp/recorded.m4a',
    darwinDeviceIndex: 2
  });

  assert.ok(args.includes('avfoundation'));
  assert.ok(args.includes(':2'));
  assert.equal(args[args.length - 1], '/tmp/recorded.m4a');
});

test('buildMicrophoneRecordArgs throws on unsupported platform', () => {
  assert.throws(
    () =>
      buildMicrophoneRecordArgs({
        platform: 'unknown-os',
        outputPath: '/tmp/a.flac',
        darwinDeviceIndex: 0
      }),
    (error) => error instanceof ControlledError && error.code === 'RECORDING_PLATFORM_UNSUPPORTED'
  );
});

