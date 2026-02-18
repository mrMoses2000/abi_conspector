import fs from 'node:fs/promises';
import path from 'node:path';
import { ControlledError } from '../utils/errors.js';
import { runCommand } from '../utils/process.js';

function clampPercent(value) {
  const percent = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(percent)) {
    return null;
  }
  return Math.max(0, Math.min(100, percent));
}

function parseWhisperProgress(text) {
  const lines = String(text || '').split('\n');
  for (const line of lines) {
    const match = line.match(/(\d{1,3})\s*%/);
    if (!match) {
      continue;
    }
    const percent = clampPercent(match[1]);
    if (percent === null) {
      continue;
    }
    return percent;
  }
  return null;
}

function toSeconds(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

function normalizeSegments(rawSegments) {
  if (!Array.isArray(rawSegments) || rawSegments.length === 0) {
    return [];
  }

  let fallbackCursorSec = 0;
  const normalized = [];
  for (const raw of rawSegments) {
    // Strip whisper-cpp timestamp patterns: [HH:MM:SS.mmm --> HH:MM:SS.mmm]
    let text = String(raw?.text ?? '')
      .replace(/\[\d{2}:\d{2}:\d{2}\.\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}\.\d{3}\]\s*/g, '')
      .trim();
    if (!text) {
      continue;
    }

    const offsets = raw?.offsets || {};
    const timestamps = raw?.timestamps || {};
    const startSec = toSeconds(
      raw?.start ?? raw?.startSec ?? raw?.from ?? offsets?.from / 1000 ?? timestamps?.fromSec,
      fallbackCursorSec
    );
    const endSec = toSeconds(
      raw?.end ?? raw?.endSec ?? raw?.to ?? offsets?.to / 1000 ?? timestamps?.toSec,
      Math.max(startSec, fallbackCursorSec + 1)
    );

    fallbackCursorSec = Math.max(endSec, startSec);
    normalized.push({
      startSec,
      endSec: Math.max(startSec, endSec),
      speakerId: 'SPEAKER_1',
      text
    });
  }

  return normalized;
}

/**
 * @param {{
 *   inputPath: string;
 *   transcriptPath: string;
 *   recordingId: string;
 *   sttConfig: {
 *     whisperCppBin: string;
 *     whisperCppModelPath: string;
 *     language: string;
 *     timeoutMs: number;
 *     whisperCppThreads: number;
 *   };
 *   onProgress?: (payload: { percent: number; message: string; }) => void;
 *   onLog?: (streamName: string, text: string) => void;
 * }} payload
 */
export async function runWhisperCppTranscription(payload) {
  const { inputPath, transcriptPath, recordingId, sttConfig, onProgress, onLog } = payload;

  const whisperCppBin = String(sttConfig.whisperCppBin || '').trim();
  const modelPath = String(sttConfig.whisperCppModelPath || '').trim();
  if (!whisperCppBin) {
    throw new ControlledError('WHISPERCPP_BIN_MISSING', 'CONSPECTOR_WHISPERCPP_BIN is not configured');
  }
  if (!modelPath) {
    throw new ControlledError(
      'WHISPERCPP_MODEL_MISSING',
      'CONSPECTOR_WHISPERCPP_MODEL_PATH is not configured'
    );
  }

  await fs.access(modelPath).catch(() => {
    throw new ControlledError('WHISPERCPP_MODEL_NOT_FOUND', `whisper.cpp model file not found: ${modelPath}`);
  });

  const outputBase = transcriptPath.endsWith('.json')
    ? transcriptPath.slice(0, -'.json'.length)
    : transcriptPath;
  const whisperJsonPath = `${outputBase}.json`;

  if (typeof onProgress === 'function') {
    onProgress({ percent: 24, message: 'whispercpp_model_load' });
  }

  const args = [
    '-m',
    modelPath,
    '-f',
    inputPath,
    '-l',
    sttConfig.language || 'ru',
    '-oj',
    '-of',
    outputBase,
    '-t',
    String(Math.max(1, Number.parseInt(String(sttConfig.whisperCppThreads || 1), 10) || 1))
  ];

  let fallbackProgress = 28;
  await runCommand({
    command: whisperCppBin,
    args,
    timeoutMs: sttConfig.timeoutMs,
    onStdout: (chunk) => {
      if (typeof onLog === 'function') {
        onLog('stdout', chunk);
      }
      const progress = parseWhisperProgress(chunk);
      if (progress !== null && typeof onProgress === 'function') {
        const mapped = Math.max(28, Math.min(92, Math.floor(28 + progress * 0.64)));
        fallbackProgress = Math.max(fallbackProgress, mapped);
        onProgress({ percent: fallbackProgress, message: `whispercpp_${progress}%` });
      }
    },
    onStderr: (chunk) => {
      if (typeof onLog === 'function') {
        onLog('stderr', chunk);
      }
      const progress = parseWhisperProgress(chunk);
      if (progress !== null && typeof onProgress === 'function') {
        const mapped = Math.max(28, Math.min(92, Math.floor(28 + progress * 0.64)));
        fallbackProgress = Math.max(fallbackProgress, mapped);
        onProgress({ percent: fallbackProgress, message: `whispercpp_${progress}%` });
      }
    }
  }).catch((error) => {
    if (error instanceof ControlledError) {
      throw new ControlledError('WHISPERCPP_EXEC_FAILED', error.message);
    }
    throw error;
  });

  const raw = await fs.readFile(whisperJsonPath, 'utf8').catch(() => null);
  if (!raw) {
    throw new ControlledError('WHISPERCPP_OUTPUT_MISSING', `whisper.cpp JSON output not found: ${whisperJsonPath}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ControlledError('WHISPERCPP_OUTPUT_PARSE_FAILED', 'Failed to parse whisper.cpp JSON output');
  }

  const rawSegments = parsed?.transcription || parsed?.result || parsed?.segments || [];
  const segments = normalizeSegments(rawSegments);
  if (segments.length === 0) {
    throw new ControlledError('WHISPERCPP_EMPTY_TRANSCRIPT', 'whisper.cpp returned empty transcript');
  }

  const output = {
    recordingId,
    language: sttConfig.language || 'ru',
    model: path.basename(modelPath),
    diarization: false,
    sttEngine: 'whispercpp',
    segments
  };

  await fs.writeFile(transcriptPath, JSON.stringify(output, null, 2), 'utf8');
  if (typeof onProgress === 'function') {
    onProgress({ percent: 100, message: 'whispercpp_done' });
  }
  return output;
}
