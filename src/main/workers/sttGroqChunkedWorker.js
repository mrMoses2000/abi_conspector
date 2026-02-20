import fs from 'node:fs/promises';
import { openAsBlob } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ControlledError } from '../utils/errors.js';
import { runCommand } from '../utils/process.js';
import { probeAudio } from '../audio/ffmpeg.js';

function mbToBytes(valueMb) {
  const parsed = Number.parseFloat(String(valueMb ?? 25));
  const normalized = Number.isFinite(parsed) && parsed > 1 ? parsed : 25;
  return Math.floor(normalized * 1024 * 1024);
}

function toSegmentsFromVerboseJson(payload, offsetSec = 0) {
  const segments = [];
  const rawSegments = Array.isArray(payload?.segments) ? payload.segments : [];

  if (rawSegments.length > 0) {
    for (const seg of rawSegments) {
      const text = String(seg?.text ?? '').trim();
      if (!text) {
        continue;
      }
      const start = Number(seg?.start);
      const end = Number(seg?.end);
      const startSec = Number.isFinite(start) ? Math.max(0, start + offsetSec) : offsetSec;
      const endSec = Number.isFinite(end) ? Math.max(startSec, end + offsetSec) : startSec + 1;
      segments.push({
        startSec,
        endSec,
        speakerId: 'SPEAKER_1',
        text
      });
    }
    return segments;
  }

  const text = String(payload?.text ?? '').trim();
  if (!text) {
    return [];
  }

  segments.push({
    startSec: Math.max(0, offsetSec),
    endSec: Math.max(1, offsetSec + 1),
    speakerId: 'SPEAKER_1',
    text
  });
  return segments;
}

/**
 * Parse the number of seconds to wait from Groq 429 retry-after header or body.
 * Groq sends: Retry-After: 312 (seconds) or a date string.
 */
function parseRetryAfterSec(response, bodyText) {
  // 1. Try Retry-After header (seconds or HTTP-date)
  const headerVal = response.headers.get('retry-after') || response.headers.get('x-ratelimit-reset-requests');
  if (headerVal) {
    const parsed = Number(headerVal);
    if (Number.isFinite(parsed) && parsed > 0) return Math.ceil(parsed);
    const date = new Date(headerVal);
    if (!Number.isNaN(date.getTime())) {
      const diffSec = Math.ceil((date.getTime() - Date.now()) / 1000);
      if (diffSec > 0) return diffSec;
    }
  }

  // 2. Try body: "Please try again in 5m12.5s" or "try again in 312s"
  const bodyMatch = bodyText.match(/try again in (?:(\d+)m)?(\d+(?:\.\d+)?)s/i);
  if (bodyMatch) {
    const minutes = Number(bodyMatch[1] || 0);
    const seconds = Number(bodyMatch[2] || 0);
    return Math.ceil(minutes * 60 + seconds) + 2; // +2s buffer
  }

  return null;
}

async function transcribeSingleFileViaGroq({ filePath, apiKey, language, model, onLog }) {
  const maxRetries = 3;
  const baseDelaySec = 15;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const form = new FormData();
    form.set('model', model);
    form.set('language', language || 'ru');
    form.set('response_format', 'verbose_json');
    form.set('timestamp_granularities[]', 'segment');
    const fileBlob = await openAsBlob(filePath);
    form.set('file', fileBlob, path.basename(filePath));

    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`
      },
      body: form
    });

    const bodyText = await response.text();
    if (typeof onLog === 'function') {
      onLog('stdout', `groq status=${response.status} file=${path.basename(filePath)} attempt=${attempt + 1}\n`);
    }

    // On 429 (rate limit): throw IMMEDIATELY.
    // executeSttFallback will switch to AssemblyAI/Deepgram without any delay.
    // Waiting here would block the chain for 5+ minutes pointlessly.
    if (response.status === 429) {
      const retryAfterSec = parseRetryAfterSec(response, bodyText);
      if (typeof onLog === 'function') {
        onLog(
          'stderr',
          `groq 429 rate limit (retry-after=${retryAfterSec ?? 'unknown'}s), falling back immediately\n`
        );
      }
      throw new ControlledError(
        'GROQ_STT_FAILED',
        `Groq STT failed with status 429: ${bodyText.slice(0, 280)}`
      );
    }

    // Retry only on transient 5xx server errors
    if (response.status >= 500 && attempt < maxRetries) {
      const delaySec = baseDelaySec * Math.pow(2, attempt);
      if (typeof onLog === 'function') {
        onLog('stdout', `groq ${response.status} server error, retrying in ${delaySec}s (attempt ${attempt + 1}/${maxRetries})\n`);
      }
      await new Promise((resolve) => setTimeout(resolve, delaySec * 1000));
      continue;
    }

    if (!response.ok) {
      throw new ControlledError(
        'GROQ_STT_FAILED',
        `Groq STT failed with status ${response.status}: ${bodyText.slice(0, 280)}`
      );
    }

    // Parse verbose_json to extract text
    try {
      const parsed = JSON.parse(bodyText);
      // Return the parsed object so caller can use segments if available
      return parsed;
    } catch {
      // Fallback: return raw text (shouldn't happen with verbose_json)
      return bodyText.trim();
    }
  }

  throw new ControlledError('GROQ_STT_FAILED', 'Groq STT failed after max retries (rate limited)');
}

async function encodeChunkMp3({ inputPath, outputPath, startSec, durationSec, bitrate }) {
  const args = [
    '-y',
    '-i',
    inputPath,
    '-ss',
    String(startSec),
    '-t',
    String(durationSec),
    '-vn',
    '-ac',
    '1',
    '-ar',
    '16000',
    '-c:a',
    'mp3',
    '-b:a',
    bitrate,
    outputPath
  ];

  await runCommand({
    command: 'ffmpeg',
    args,
    timeoutMs: 8 * 60 * 1000
  }).catch((error) => {
    if (error instanceof ControlledError) {
      throw new ControlledError('GROQ_CHUNK_ENCODING_FAILED', error.message);
    }
    throw error;
  });
}

/**
 * @param {{
 *   inputPath: string;
 *   transcriptPath: string;
 *   recordingId: string;
 *   sttConfig: {
 *     language: string;
 *     timeoutMs: number;
 *     groqApiKey: string;
 *     groqModel: string;
 *     groqMaxFileMb: number;
 *     groqChunkMinutes: number;
 *   };
 *   onProgress?: (payload: { percent: number; message: string; }) => void;
 *   onLog?: (streamName: string, text: string) => void;
 * }} payload
 */
export async function runGroqChunkedTranscription(payload) {
  const { inputPath, transcriptPath, recordingId, sttConfig, onProgress, onLog } = payload;

  const groqApiKey = String(sttConfig.groqApiKey || '').trim();
  if (!groqApiKey) {
    throw new ControlledError('GROQ_API_KEY_MISSING', 'CONSPECTOR_GROQ_API_KEY (or GROQ_API_KEY) is not configured');
  }

  const groqModel = String(sttConfig.groqModel || 'whisper-large-v3').trim();
  const maxBytes = mbToBytes(sttConfig.groqMaxFileMb);

  if (typeof onProgress === 'function') {
    onProgress({ percent: 22, message: 'groq_prepare' });
  }

  const stat = await fs.stat(inputPath).catch(() => null);
  if (!stat || !stat.isFile()) {
    throw new ControlledError('GROQ_INPUT_NOT_FOUND', `Input audio file not found: ${inputPath}`);
  }

  const isSingleUpload = stat.size <= maxBytes;
  let allSegments = [];

  if (isSingleUpload) {
    if (typeof onProgress === 'function') {
      onProgress({ percent: 30, message: 'groq_upload_single' });
    }
    const result = await transcribeSingleFileViaGroq({
      filePath: inputPath,
      apiKey: groqApiKey,
      language: sttConfig.language || 'ru',
      model: groqModel,
      onLog
    });
    if (result && typeof result === 'object') {
      // verbose_json response — use segments with timestamps
      const segs = toSegmentsFromVerboseJson(result, 0);
      allSegments.push(...segs);
    } else if (result) {
      // plain text fallback
      allSegments.push({ startSec: 0, endSec: 1, speakerId: 'SPEAKER_1', text: String(result) });
    }
  } else {
    const probe = await probeAudio(inputPath);
    if (!probe.durationSec || probe.durationSec <= 0) {
      throw new ControlledError('GROQ_CHUNK_DURATION_UNKNOWN', 'Could not determine audio duration for chunking');
    }

    const chunkSec = Math.max(
      60,
      Math.floor((Number.parseInt(String(sttConfig.groqChunkMinutes || 18), 10) || 18) * 60)
    );
    const totalChunks = Math.max(1, Math.ceil(probe.durationSec / chunkSec));
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'conspector-groq-'));

    try {
      for (let index = 0; index < totalChunks; index += 1) {
        const startSec = index * chunkSec;
        const spanSec = Math.max(1, Math.min(chunkSec, probe.durationSec - startSec));
        const chunkPath = path.join(tmpDir, `chunk_${String(index + 1).padStart(4, '0')}.mp3`);

        await encodeChunkMp3({
          inputPath,
          outputPath: chunkPath,
          startSec,
          durationSec: spanSec,
          bitrate: '32k'
        });

        const chunkStat = await fs.stat(chunkPath);
        if (chunkStat.size > maxBytes) {
          await encodeChunkMp3({
            inputPath,
            outputPath: chunkPath,
            startSec,
            durationSec: spanSec,
            bitrate: '24k'
          });
        }

        if (typeof onLog === 'function') {
          onLog(
            'stdout',
            `groq chunk ${index + 1}/${totalChunks} start=${startSec.toFixed(1)}s length=${spanSec.toFixed(1)}s\n`
          );
        }
        if (typeof onProgress === 'function') {
          const before = 26 + Math.floor((index / Math.max(1, totalChunks)) * 64);
          onProgress({ percent: before, message: `groq_chunk_${index + 1}_upload` });
        }

        const chunkResult = await transcribeSingleFileViaGroq({
          filePath: chunkPath,
          apiKey: groqApiKey,
          language: sttConfig.language || 'ru',
          model: groqModel,
          onLog
        });
        if (chunkResult && typeof chunkResult === 'object') {
          // verbose_json — use real segment timestamps offset by chunk start
          const segs = toSegmentsFromVerboseJson(chunkResult, startSec);
          allSegments.push(...segs);
        } else if (chunkResult) {
          // plain text fallback
          allSegments.push({ startSec, endSec: startSec + spanSec, speakerId: 'SPEAKER_1', text: String(chunkResult) });
        }

        if (typeof onProgress === 'function') {
          const after = 30 + Math.floor(((index + 1) / Math.max(1, totalChunks)) * 62);
          onProgress({ percent: after, message: `groq_chunk_${index + 1}_done` });
        }
      }
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => { });
    }
  }

  if (!Array.isArray(allSegments) || allSegments.length === 0) {
    throw new ControlledError('GROQ_EMPTY_TRANSCRIPT', 'Groq returned empty transcript');
  }

  const output = {
    recordingId,
    language: sttConfig.language || 'ru',
    model: groqModel,
    diarization: false,
    sttEngine: 'groq',
    segments: allSegments
  };

  await fs.writeFile(transcriptPath, JSON.stringify(output, null, 2), 'utf8');
  if (typeof onProgress === 'function') {
    onProgress({ percent: 100, message: 'groq_done' });
  }
  return output;
}

