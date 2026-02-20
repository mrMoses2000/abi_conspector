import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { ControlledError } from '../utils/errors.js';
import { runGroqChunkedTranscription } from './sttGroqChunkedWorker.js';
import { runWhisperCppTranscription } from './sttWhisperCppWorker.js';
import { runAssemblyAiTranscription } from './sttAssemblyAiWorker.js';
import { runDeepgramTranscription } from './sttDeepgramWorker.js';
import { executeSttFallback } from '../utils/fallback.js';

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

const KNOWN_ENGINES = ['groq', 'assemblyai', 'deepgram', 'whispercpp'];

function buildEngineRunner(engine) {
  if (engine === 'groq') return runGroqChunkedTranscription;
  if (engine === 'assemblyai') return runAssemblyAiTranscription;
  if (engine === 'deepgram') return runDeepgramTranscription;
  if (engine === 'whispercpp') return runWhisperCppTranscription;
  return null;
}

/**
 * Check if engine has the required API key configured.
 */
function isEngineConfigured(engine, sttConfig) {
  if (engine === 'groq') return !!String(sttConfig.groqApiKey || '').trim();
  if (engine === 'assemblyai') return !!String(sttConfig.assemblyaiApiKey || '').trim();
  if (engine === 'deepgram') return !!String(sttConfig.deepgramApiKey || '').trim();
  if (engine === 'whispercpp') return true; // always available if installed
  return false;
}

/**
 * Build the ordered fallback chain from config.
 * Supports both legacy (primary+fallback) and new (fallbackChain) config.
 */
export function buildFallbackChain(sttConfig) {
  // New-style: explicit ordered chain
  if (Array.isArray(sttConfig.fallbackChain) && sttConfig.fallbackChain.length > 0) {
    return sttConfig.fallbackChain.filter((e) => KNOWN_ENGINES.includes(e));
  }

  // Legacy: primary + fallback
  const primary = String(sttConfig.primary || 'groq').trim().toLowerCase();
  const fallback = String(sttConfig.fallback || 'whispercpp').trim().toLowerCase();
  const chain = [];
  if (KNOWN_ENGINES.includes(primary)) chain.push(primary);
  if (KNOWN_ENGINES.includes(fallback) && fallback !== primary && fallback !== 'none') {
    chain.push(fallback);
  }
  return chain.length > 0 ? chain : ['groq'];
}

/**
 * Remove partial transcript file if it exists (cleanup after failed provider).
 */
async function cleanupPartialTranscript(transcriptPath, onLog) {
  try {
    const stat = await fs.stat(transcriptPath).catch(() => null);
    if (stat && stat.isFile()) {
      await fs.unlink(transcriptPath);
      if (typeof onLog === 'function') {
        onLog('meta', `cleaned up partial transcript file: ${transcriptPath}\n`);
      }
    }
  } catch {
    // Ignore cleanup errors
  }
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
 *     primary: string;
 *     fallback: string;
 *     fallbackChain: string[];
 *     groqApiKey: string;
 *     groqModel: string;
 *     groqMaxFileMb: number;
 *     groqChunkMinutes: number;
 *     assemblyaiApiKey: string;
 *     deepgramApiKey: string;
 *     deepgramModel: string;
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

  const chain = buildFallbackChain(sttConfig);
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

  writeLog('meta', `fallback chain: [${chain.join(' → ')}]\n`);
  emitProgress(20, `stt_chain_start`);

  try {
    let finalTranscript = null;
    let fallbackWarnings = [];

    await executeSttFallback(
      chain,
      async (engine) => {
        // Runner: try one engine
        if (!isEngineConfigured(engine, sttConfig)) {
          const skipMsg = `skipping ${engine}: not configured (no API key)`;
          writeLog('meta', `${skipMsg}\n`);
          fallbackWarnings.push(skipMsg);
          throw new Error('Not configured'); // trigger fallback
        }

        emitProgress(20, `stt_engine_${engine}_start`);
        const transcript = await executeEngine(engine);

        // Validate result
        if (!Array.isArray(transcript?.segments) || transcript.segments.length === 0) {
          throw new ControlledError('STT_EMPTY_RESULT', `${engine} returned empty segments`);
        }

        if (fallbackWarnings.length > 0) {
          transcript.warning = fallbackWarnings.join('; ');
        }

        finalTranscript = transcript;
      },
      async (engine, error) => {
        // onFallback: log and cleanup
        const errorText = error.message;
        if (errorText !== 'Not configured') {
          writeLog('meta', `engine=${engine} failed: ${errorText}\n`);
          fallbackWarnings.push(`stt ${engine} failed, trying next: ${errorText}`);
          // CRITICAL: Clean up partial transcript file before trying next engine
          await cleanupPartialTranscript(transcriptPath, writeLog);
        }
        emitProgress(25, `stt_fallback_after_${engine}`);
      }
    );

    emitProgress(100, 'Транскрибация завершена');
    return finalTranscript;
  } catch (err) {
    // executeSttFallback throws if ALL engines fail
    throw new ControlledError(
      'STT_ALL_ENGINES_FAILED',
      `${err.message}. Chain: [${chain.join(' → ')}]. Лог: ${logPath}`
    );
  } finally {
    await new Promise((resolve) => {
      logStream.end(resolve);
    });
  }
}
