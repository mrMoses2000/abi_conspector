import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { ControlledError } from '../utils/errors.js';

const DEFAULT_STOP_TIMEOUT_MS = 7000;

function randomId() {
  return crypto.randomUUID();
}

/**
 * @param {string} text
 */
export function parseDarwinAudioDevices(text) {
  const lines = String(text || '').split('\n');
  const devices = [];
  let inAudioSection = false;

  for (const line of lines) {
    if (line.includes('AVFoundation audio devices')) {
      inAudioSection = true;
      continue;
    }

    if (line.includes('AVFoundation video devices')) {
      inAudioSection = false;
      continue;
    }

    if (!inAudioSection) {
      continue;
    }

    const match = line.match(/\[(\d+)\]\s+(.+)$/);
    if (!match) {
      continue;
    }

    devices.push({
      index: Number.parseInt(match[1], 10),
      name: match[2].trim()
    });
  }

  return devices.filter((item) => Number.isFinite(item.index));
}

/**
 * @param {{ ffmpegBin: string }} payload
 */
export function discoverDarwinAudioDeviceIndex(payload) {
  const result = spawnSync(
    payload.ffmpegBin,
    ['-f', 'avfoundation', '-list_devices', 'true', '-i', ''],
    { encoding: 'utf8' }
  );
  const combined = `${result.stdout || ''}\n${result.stderr || ''}`;
  const devices = parseDarwinAudioDevices(combined);
  return devices.length > 0 ? devices[0].index : 0;
}

/**
 * @param {{ platform: string; outputPath: string; darwinDeviceIndex: number; }} payload
 */
export function buildMicrophoneRecordArgs(payload) {
  const { platform, outputPath, darwinDeviceIndex } = payload;

  if (platform === 'darwin') {
    return [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'avfoundation',
      '-i',
      `:${darwinDeviceIndex}`,
      '-vn',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      outputPath
    ];
  }

  if (platform === 'linux') {
    return [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'pulse',
      '-i',
      'default',
      '-vn',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-c:a',
      'flac',
      outputPath
    ];
  }

  if (platform === 'win32') {
    return [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'dshow',
      '-i',
      'audio=default',
      '-vn',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      outputPath
    ];
  }

  throw new ControlledError('RECORDING_PLATFORM_UNSUPPORTED', `Unsupported platform: ${platform}`);
}

function waitForClose(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn) => (value) => {
      if (done) {
        return;
      }
      done = true;
      clearTimeout(timer);
      fn(value);
    };

    const resolveOnce = finish(resolve);
    const rejectOnce = finish(reject);

    const timer = setTimeout(() => {
      child.kill('SIGINT');
      setTimeout(() => child.kill('SIGKILL'), 1500).unref();
      rejectOnce(new ControlledError('RECORDING_STOP_TIMEOUT', `Recorder stop timed out after ${timeoutMs} ms`));
    }, timeoutMs);

    child.once('close', (code) => {
      if (code === 0 || code === null) {
        resolveOnce(code);
        return;
      }
      rejectOnce(new ControlledError('RECORDING_STOP_FAILED', `Recorder exited with code ${code}`));
    });
  });
}

export class MicrophoneRecorder {
  /**
   * @param {{
   *   ffmpegBin?: string;
   *   platform?: string;
   *   managedImportsDir: string;
   *   darwinDeviceIndex?: number | null;
   * }} payload
   */
  constructor(payload) {
    this.ffmpegBin = payload.ffmpegBin || 'ffmpeg';
    this.platform = payload.platform || process.platform;
    this.managedImportsDir = payload.managedImportsDir;
    this.darwinDeviceIndex = payload.darwinDeviceIndex ?? null;
    this.active = null;
  }

  isRecording() {
    return Boolean(this.active);
  }

  getState() {
    if (!this.active) {
      return {
        isRecording: false
      };
    }

    return {
      isRecording: true,
      startedAt: this.active.startedAt,
      recordingPath: this.active.outputPath
    };
  }

  async start() {
    if (this.active) {
      throw new ControlledError('RECORDING_ALREADY_RUNNING', 'Microphone recording is already running');
    }

    await fs.mkdir(this.managedImportsDir, { recursive: true });

    let deviceIndex = this.darwinDeviceIndex;
    if (this.platform === 'darwin' && !Number.isFinite(deviceIndex)) {
      deviceIndex = discoverDarwinAudioDeviceIndex({ ffmpegBin: this.ffmpegBin });
    }

    const extension = this.platform === 'linux' ? '.flac' : '.m4a';
    const filename = `mic_${Date.now()}_${randomId()}${extension}`;
    const outputPath = path.join(this.managedImportsDir, filename);

    const args = buildMicrophoneRecordArgs({
      platform: this.platform,
      outputPath,
      darwinDeviceIndex: Number.isFinite(deviceIndex) ? deviceIndex : 0
    });

    const child = spawn(this.ffmpegBin, args, {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let startupResolved = false;
    let stderrTail = '';

    const ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        startupResolved = true;
        resolve();
      }, 700);

      child.once('error', (error) => {
        clearTimeout(timer);
        reject(new ControlledError('RECORDING_START_FAILED', `${this.ffmpegBin}: ${error.message}`));
      });

      child.once('spawn', () => {
        clearTimeout(timer);
        startupResolved = true;
        resolve();
      });
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderrTail = `${stderrTail}${text}`.slice(-6000);
    });

    child.on('close', (code) => {
      if (!startupResolved || !this.active || this.active.child !== child) {
        return;
      }

      if (!this.active.stopRequested && code !== 0 && code !== null) {
        this.active.unexpectedError = `recorder exited unexpectedly (${code})`;
        this.active.stderrTail = stderrTail;
      }
    });

    await ready;

    this.active = {
      child,
      outputPath,
      startedAt: new Date().toISOString(),
      stopRequested: false,
      stderrTail
    };

    return this.getState();
  }

  async stop() {
    if (!this.active) {
      throw new ControlledError('RECORDING_NOT_RUNNING', 'Microphone recording is not running');
    }

    const session = this.active;
    session.stopRequested = true;

    try {
      session.child.stdin.write('q\n');
      session.child.stdin.end();
    } catch {
      // ignore stdin close issues
    }

    let stopWarning = null;
    try {
      await waitForClose(session.child, DEFAULT_STOP_TIMEOUT_MS);
    } catch (error) {
      stopWarning = error instanceof Error ? error.message : 'Recorder stop warning';
    }

    this.active = null;

    const stats = await fs.stat(session.outputPath).catch(() => null);
    if (!stats || stats.size < 1024) {
      throw new ControlledError('RECORDING_EMPTY', 'Recorded audio file is empty or missing');
    }

    return {
      recordingPath: session.outputPath,
      startedAt: session.startedAt,
      stoppedAt: new Date().toISOString(),
      warning: stopWarning
    };
  }

  forceStop() {
    if (!this.active) {
      return;
    }

    try {
      this.active.child.kill('SIGKILL');
    } catch {
      // ignore process kill errors
    }

    this.active = null;
  }
}
