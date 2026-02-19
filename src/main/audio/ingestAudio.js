import fs from 'node:fs/promises';
import path from 'node:path';
import { probeAudio } from './ffmpeg.js';
import { ControlledError } from '../utils/errors.js';
import { hashFileSha256 } from '../utils/fs.js';

/**
 * @param {{
 *   managedAudioPath: string;
 *   sourceType: 'microphone' | 'imported_file';
 *   originalFileName?: string | null;
 *   originalFilePath?: string | null;
 *   subjectId?: string | null;
 *   db: import('../db/database.js').AppDatabase;
 *   maxLectureSeconds: number;
 *   queue: { enqueue: (jobId: string) => void };
 *   cleanupOnError?: boolean;
 * }} payload
 */
export async function ingestManagedAudio(payload) {
  const {
    managedAudioPath,
    sourceType,
    originalFileName = null,
    originalFilePath = null,
    subjectId = null,
    db,
    maxLectureSeconds,
    queue,
    cleanupOnError = true
  } = payload;

  if (!managedAudioPath || typeof managedAudioPath !== 'string') {
    throw new ControlledError('INVALID_INPUT_PATH', 'Audio path is required');
  }

  if (sourceType !== 'microphone' && sourceType !== 'imported_file') {
    throw new ControlledError('INVALID_SOURCE_TYPE', `Unsupported source type: ${String(sourceType)}`);
  }

  let probe;
  let audioSha256;
  try {
    probe = await probeAudio(managedAudioPath);
    if (!probe.hasAudio) {
      throw new ControlledError('NO_AUDIO_STREAM', 'The selected file has no audio stream');
    }
    audioSha256 = await hashFileSha256(managedAudioPath);
  } catch (error) {
    if (cleanupOnError) {
      await fs.unlink(managedAudioPath).catch(() => undefined);
    }

    if (error instanceof ControlledError) {
      throw error;
    }

    throw new ControlledError('AUDIO_IMPORT_FAILED', 'Could not process selected audio file');
  }

  const recordingId = db.createRecording({
    sourceType,
    originalFileName: originalFileName ?? path.basename(managedAudioPath),
    originalFilePath,
    managedAudioPath,
    normalizedAudioPath: null,
    audioSha256,
    subjectId,
    durationSec: probe.durationSec
  });

  const warning =
    probe.durationSec > maxLectureSeconds
      ? 'Duration is longer than 3 hours. Processing may take more time.'
      : null;

  const jobId = db.createMergeJob({
    recordingId,
    stage: 'normalize_audio',
    status: 'queued',
    warning
  });

  queue.enqueue(jobId);

  return {
    recordingId,
    managedAudioPath,
    durationSec: probe.durationSec,
    originalFilename: originalFileName ?? path.basename(managedAudioPath),
    normalizationStatus: 'queued',
    warning
  };
}
