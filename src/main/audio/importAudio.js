import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { ControlledError } from '../utils/errors.js';
import { ingestManagedAudio } from './ingestAudio.js';

function randomFileId() {
  return crypto.randomUUID();
}

/**
 * @param {{
 *   inputPath: string;
 *   db: import('../db/database.js').AppDatabase;
 *   managedPaths: ReturnType<import('../config.js').getManagedPaths>;
 *   maxLectureSeconds: number;
 *   queue: { enqueue: (jobId: string) => void };
 * }} payload
 */
export async function importAudioFile(payload) {
  const { inputPath, db, managedPaths, maxLectureSeconds, queue } = payload;

  if (!inputPath || typeof inputPath !== 'string') {
    throw new ControlledError('INVALID_INPUT_PATH', 'Audio path is required');
  }

  const stats = await fs.stat(inputPath).catch(() => null);
  if (!stats || !stats.isFile()) {
    throw new ControlledError('FILE_NOT_FOUND', 'Audio file does not exist');
  }

  const originalFilename = path.basename(inputPath);
  const ext = path.extname(originalFilename);
  const managedName = `${Date.now()}_${randomFileId()}${ext || '.bin'}`;
  const managedAudioPath = path.join(managedPaths.imports, managedName);

  await fs.copyFile(inputPath, managedAudioPath);

  return ingestManagedAudio({
    managedAudioPath,
    sourceType: 'imported_file',
    originalFileName: originalFilename,
    originalFilePath: inputPath,
    db,
    maxLectureSeconds,
    queue,
    cleanupOnError: true
  });
}
