import fs from 'node:fs/promises';
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
 * }} payload
 */
export async function runSttDiarization(payload) {
  const { recording, normalizedAudioPath, transcriptPath, sttConfig } = payload;

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

  if (sttConfig.hfToken) {
    args.push('--hf-token', sttConfig.hfToken);
  }

  try {
    await runCommand({
      command: sttConfig.pythonBin,
      args,
      timeoutMs: sttConfig.timeoutMs
    });
  } catch (error) {
    if (error instanceof ControlledError) {
      throw new ControlledError('STT_DIARIZATION_FAILED', error.message);
    }
    throw error;
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

  return transcript;
}
