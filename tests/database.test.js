import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AppDatabase } from '../src/main/db/database.js';

test('database stores imported_file recordings with new schema fields', async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'abi-db-test-'));
  const dbPath = path.join(tmpRoot, 'app.db');
  const db = new AppDatabase(dbPath);

  const recordingId = db.createRecording({
    sourceType: 'imported_file',
    originalFileName: 'lecture.mp3',
    originalFilePath: '/tmp/lecture.mp3',
    managedAudioPath: '/managed/imports/file.mp3',
    normalizedAudioPath: null,
    audioSha256: 'abc123',
    durationSec: 120
  });

  const jobId = db.createMergeJob({
    recordingId,
    stage: 'normalize_audio',
    status: 'queued',
    warning: null
  });

  const recording = db.getRecording(recordingId);
  assert.equal(recording.source_type, 'imported_file');
  assert.equal(recording.original_file_name, 'lecture.mp3');
  assert.equal(recording.normalized_audio_path, null);
  assert.equal(recording.audio_sha256, 'abc123');

  db.updateRecordingNormalization(recordingId, '/managed/audio/file.flac');
  const updated = db.getRecording(recordingId);
  assert.equal(updated.normalized_audio_path, '/managed/audio/file.flac');

  db.updateMergeJob(jobId, 'normalize_audio', 'running', null);
  db.completeMergeJob(jobId);
  const job = db.getMergeJob(jobId);
  assert.equal(job.status, 'done');
  assert.equal(job.stage, 'done');

  db.close();
});
