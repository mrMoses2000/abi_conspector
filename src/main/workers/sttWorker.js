import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { ControlledError } from '../utils/errors.js';
import { runGroqChunkedTranscription } from './sttGroqChunkedWorker.js';
import { runWhisperCppTranscription } from './sttWhisperCppWorker.js';

function buildMockTranscript(recording, language) {
  return {
    recordingId: recording.id,
    language,
    model: 'mock',
    diarization: false,
    sttEngine: 'mock',
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

function normalizeEngine(value, fallback) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'groq' || normalized === 'whispercpp' || normalized === 'none') {
    return normalized;
  }
  return fallback;
}

function buildEngineRunner(engine) {
  if (engine === 'groq') {
    return runGroqChunkedTranscription;
  }
  if (engine === 'whispercpp') {
    return runWhisperCppTranscription;
  }
  return null;
}

/**
 * @param {{
 *   recording: any;
 *   normalizedAudioPath: string;
 *   transcriptPath: string;
 *   sttConfig: {
 *     mode: 'real' | 'mock';
 *     language: string;
 *     timeoutMs: number;
 *     primary: 'groq' | 'whispercpp';
 *     fallback: 'whispercpp' | 'none';
 *     groqApiKey: string;
 *     groqModel: string;
 *     groqMaxFileMb: number;
 *     groqChunkMinutes: number;
 *     whisperCppBin: string;
 *     whisperCppModelPath: string;
 *     whisperCppThreads: number;
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

  const primary = normalizeEngine(sttConfig.primary, 'groq');
  const fallback = normalizeEngine(sttConfig.fallback, 'whispercpp');

  const logStream = createWriteStream(logPath, { flags: 'a', encoding: 'utf8' });
  const emitProgress = (percent, message) => {
    if (typeof onProgress === 'function') {
      onProgress({ percent, message, logPath });
    }
  };
  const writeLog = (streamName, text) => {
    logStream.write(`[${new Date().toISOString()}][${streamName}] ${text}`);
  };

  const executeEngine = async (engine) => {
    const runner = buildEngineRunner(engine);
    if (!runner) {
      throw new ControlledError('STT_ENGINE_UNKNOWN', `Unsupported STT engine: ${engine}`);
    }

    writeLog('meta', `engine=${engine} start timeoutMs=${sttConfig.timeoutMs}\n`);
    const result = await runner({
      inputPath: normalizedAudioPath,
      transcriptPath,
      recordingId: recording.id,
      sttConfig,
      onProgress: ({ percent, message }) => emitProgress(percent, message || engine),
      onLog: writeLog
    });
    writeLog('meta', `engine=${engine} done segments=${Array.isArray(result?.segments) ? result.segments.length : 0}\n`);
    return result;
  };

  emitProgress(20, `stt_engine_${primary}_start`);
  let fallbackWarning = '';

  try {
    try {
      const transcript = await executeEngine(primary);
      emitProgress(100, 'Транскрибация завершена');
      return transcript;
    } catch (primaryError) {
      const primaryText = primaryError instanceof Error ? primaryError.message : String(primaryError);
      writeLog('meta', `engine=${primary} failed: ${primaryText}\n`);

      const shouldFallback = fallback !== 'none' && fallback !== primary;
      if (!shouldFallback) {
        throw primaryError;
      }

      fallbackWarning = `stt ${primary} failed, fallback to ${fallback}: ${primaryText}`;
      emitProgress(34, `stt_fallback_${fallback}`);
      const transcript = await executeEngine(fallback);
      transcript.warning = fallbackWarning;
      emitProgress(100, 'Транскрибация завершена (fallback)');
      return transcript;
    }
  } catch (error) {
    writeLog('meta', `failed ${error instanceof Error ? error.message : 'unknown error'}\n`);
    if (error instanceof ControlledError) {
      throw new ControlledError('STT_DIARIZATION_FAILED', `${error.message}. Лог: ${logPath}`);
    }
    throw error;
  } finally {
    await new Promise((resolve) => {
      logStream.end(resolve);
    });
  }
}

