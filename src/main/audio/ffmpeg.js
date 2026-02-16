import { spawn } from 'node:child_process';
import { safeParseJson } from '../utils/fs.js';
import { ControlledError } from '../utils/errors.js';

function runProcess(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => reject(err));

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      const message = stderr.trim() || stdout.trim() || `Process failed with code ${code}`;
      reject(new ControlledError('FFMPEG_PROCESS_FAILED', message));
    });
  });
}

/**
 * @param {string} inputPath
 */
export function buildProbeArgs(inputPath) {
  return ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', inputPath];
}

/**
 * @param {{ inputPath: string; outputPath: string; sampleRateHz: number; channels: number; }} payload
 */
export function buildNormalizeArgs(payload) {
  return [
    '-y',
    '-i',
    payload.inputPath,
    '-vn',
    '-ac',
    String(payload.channels),
    '-ar',
    String(payload.sampleRateHz),
    '-c:a',
    'flac',
    payload.outputPath
  ];
}

/**
 * @param {string} inputPath
 */
export async function probeAudio(inputPath) {
  let result;
  try {
    result = await runProcess('ffprobe', buildProbeArgs(inputPath));
  } catch (error) {
    if (error instanceof ControlledError) {
      throw error;
    }

    throw new ControlledError('FFPROBE_NOT_FOUND', 'ffprobe is not available in PATH');
  }

  const parsed = safeParseJson(result.stdout);
  if (!parsed) {
    throw new ControlledError('FFPROBE_PARSE_ERROR', 'Could not parse ffprobe output');
  }

  const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
  const hasAudio = streams.some((stream) => stream.codec_type === 'audio');

  const durationRaw = Number(parsed?.format?.duration);
  const durationSec = Number.isFinite(durationRaw) && durationRaw > 0 ? durationRaw : 0;

  return {
    hasAudio,
    durationSec
  };
}

/**
 * @param {{
 *   inputPath: string;
 *   outputPath: string;
 *   sampleRateHz: number;
 *   channels: number;
 * }} payload
 */
export async function normalizeToFlac(payload) {
  try {
    await runProcess('ffmpeg', buildNormalizeArgs(payload));
  } catch (error) {
    if (error instanceof ControlledError) {
      throw error;
    }

    throw new ControlledError('FFMPEG_NOT_FOUND', 'ffmpeg is not available in PATH');
  }

  return payload.outputPath;
}
