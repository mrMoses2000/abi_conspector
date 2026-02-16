import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { ControlledError } from '../utils/errors.js';
import { runCommand } from '../utils/process.js';

function buildMockTranscript(recording, language) {
  return {
    recordingId: recording.id,
    language,
    model: 'mock',
    diarization: true,
    segments: [
      {
        startSec: 0,
        endSec: Math.min(recording.duration_sec, 45),
        speakerId: 'SPEAKER_1',
        text: 'Mock STT result. Switch CONSPECTOR_STT_MODE=real for actual transcription.'
      }
    ]
  };
}

/**
 * @param {{
 *   recording: any;
 *   transcriptPath: string;
 *   language: string;
 * }} payload
 */
export async function writeMockTranscript(payload) {
  const transcript = buildMockTranscript(payload.recording, payload.language);
  await fs.writeFile(payload.transcriptPath, JSON.stringify(transcript, null, 2), 'utf8');
  return transcript;
}

function parseProgressLine(line) {
  const match = String(line).trim().match(/^STT_PROGRESS\s+(\d{1,3})(?:\s+(.*))?$/i);
  if (!match) {
    return null;
  }
  const percent = Number.parseInt(match[1], 10);
  if (!Number.isFinite(percent)) {
    return null;
  }
  return {
    percent: Math.max(0, Math.min(100, percent)),
    message: (match[2] || '').trim()
  };
}

/**
 * @param {{
 *   recording: any;
  *   normalizedAudioPath: string;
  *   transcriptPath: string;
 *   sttConfig: {
 *     mode: 'real' | 'mock';
 *     pythonBin: string;
 *     scriptPath: string;
 *     model: string;
 *     language: string;
 *     device: string;
 *     computeType: string;
 *     batchSize: number;
 *     hfToken: string;
 *     requireDiarization: boolean;
 *     timeoutMs: number;
 *   };
 *   onProgress?: (payload: { percent: number; message: string; logPath: string; }) => void;
 * }} payload
 */
export async function runSttDiarization(payload) {
  const { recording, normalizedAudioPath, transcriptPath, sttConfig, onProgress } = payload;
  const logPath = `${transcriptPath}.stt.log`;

  if (sttConfig.mode === 'mock') {
    return writeMockTranscript({
      recording,
      transcriptPath,
      language: sttConfig.language
    });
  }

  const scriptPath = path.resolve(sttConfig.scriptPath);
  const args = [
    scriptPath,
    '--input',
    normalizedAudioPath,
    '--output',
    transcriptPath,
    '--recording-id',
    recording.id,
    '--model',
    sttConfig.model,
    '--language',
    sttConfig.language,
    '--device',
    sttConfig.device,
    '--compute-type',
    sttConfig.computeType,
    '--batch-size',
    String(sttConfig.batchSize)
  ];

  if (sttConfig.requireDiarization) {
    args.push('--require-diarization');
  }

  const logStream = createWriteStream(logPath, { flags: 'a', encoding: 'utf8' });
  let stderrBuffer = '';
  const emitProgress = (percent, message) => {
    if (typeof onProgress === 'function') {
      onProgress({ percent, message, logPath });
    }
  };
  const writeLog = (streamName, text) => {
    logStream.write(`[${new Date().toISOString()}][${streamName}] ${text}`);
  };

  writeLog(
    'meta',
    `start model=${sttConfig.model} device=${sttConfig.device} compute=${sttConfig.computeType} batch=${sttConfig.batchSize}\n`
  );
  emitProgress(20, 'Загрузка модели STT');

  try {
    await runCommand({
      command: sttConfig.pythonBin,
      args,
      timeoutMs: sttConfig.timeoutMs,
      env: {
        ...process.env,
        HUGGINGFACE_TOKEN: sttConfig.hfToken || process.env.HUGGINGFACE_TOKEN || ''
      },
      onStdout: (chunk) => writeLog('stdout', chunk),
      onStderr: (chunk) => {
        writeLog('stderr', chunk);
        stderrBuffer += chunk;
        const lines = stderrBuffer.split('\n');
        stderrBuffer = lines.pop() || '';
        for (const line of lines) {
          const parsed = parseProgressLine(line);
          if (!parsed) {
            continue;
          }
          emitProgress(parsed.percent, parsed.message || 'Обработка STT');
        }
      }
    });
  } catch (error) {
    writeLog(
      'meta',
      `failed ${error instanceof Error ? error.message : 'unknown error'}\n`
    );
    if (error instanceof ControlledError) {
      throw new ControlledError(
        'STT_DIARIZATION_FAILED',
        `${error.message}. Лог: ${logPath}`
      );
    }
    throw error;
  } finally {
    await new Promise((resolve) => {
      logStream.end(resolve);
    });
  }

  const raw = await fs.readFile(transcriptPath, 'utf8').catch(() => null);
  if (!raw) {
    throw new ControlledError('TRANSCRIPT_NOT_CREATED', 'STT worker did not create transcript file');
  }

  let transcript;
  try {
    transcript = JSON.parse(raw);
  } catch {
    throw new ControlledError('TRANSCRIPT_PARSE_FAILED', 'Transcript JSON is invalid');
  }

  if (!Array.isArray(transcript.segments) || transcript.segments.length === 0) {
    throw new ControlledError('TRANSCRIPT_EMPTY', 'Transcript has no segments');
  }

  emitProgress(100, 'Транскрибация завершена');
  return transcript;
}
