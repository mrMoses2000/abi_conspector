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

test('database recovers stale running/queued jobs on startup', async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'abi-db-recover-'));
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

  const queuedJobId = db.createMergeJob({
    recordingId,
    stage: 'normalize_audio',
    status: 'queued',
    warning: null
  });
  const runningJobId = db.createMergeJob({
    recordingId,
    stage: 'stt_diarization',
    status: 'queued',
    warning: null
  });
  db.updateMergeJob(runningJobId, 'stt_diarization', 'running', null);

  const recovered = db.recoverStaleJobs();
  assert.equal(recovered, 2);

  const queued = db.getMergeJob(queuedJobId);
  const running = db.getMergeJob(runningJobId);

  assert.equal(queued.status, 'failed');
  assert.equal(running.status, 'failed');
  assert.equal(queued.error_code, 'RECOVERED_STALE_JOB');
  assert.equal(running.error_code, 'RECOVERED_STALE_JOB');
  assert.match(queued.error_message, /restarted/i);

  db.close();
});

test('database cleanup removes failed jobs and orphan recordings', async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'abi-db-cleanup-'));
  const dbPath = path.join(tmpRoot, 'app.db');
  const db = new AppDatabase(dbPath);

  const recFailedOnly = db.createRecording({
    sourceType: 'imported_file',
    originalFileName: 'failed-only.mp3',
    originalFilePath: '/tmp/failed-only.mp3',
    managedAudioPath: '/managed/imports/failed-only.mp3',
    normalizedAudioPath: '/managed/audio/failed-only.flac',
    audioSha256: 'failed-only',
    durationSec: 33
  });
  const recMixed = db.createRecording({
    sourceType: 'imported_file',
    originalFileName: 'mixed.mp3',
    originalFilePath: '/tmp/mixed.mp3',
    managedAudioPath: '/managed/imports/mixed.mp3',
    normalizedAudioPath: '/managed/audio/mixed.flac',
    audioSha256: 'mixed',
    durationSec: 44
  });

  const failedJobId = db.createMergeJob({
    recordingId: recFailedOnly,
    stage: 'stt_diarization',
    status: 'queued',
    warning: null
  });
  db.failMergeJob(failedJobId, 'stt_diarization', 'STT_FAIL', 'boom');

  const mixedFailedJobId = db.createMergeJob({
    recordingId: recMixed,
    stage: 'stt_diarization',
    status: 'queued',
    warning: null
  });
  db.failMergeJob(mixedFailedJobId, 'stt_diarization', 'STT_FAIL', 'boom');

  const mixedDoneJobId = db.createMergeJob({
    recordingId: recMixed,
    stage: 'merge',
    status: 'queued',
    warning: null
  });
  db.completeMergeJob(mixedDoneJobId, null);

  const cleanup = db.cleanupFailedJobs();
  assert.equal(cleanup.deletedJobs, 2);
  assert.equal(cleanup.deletedRecordings.length, 1);
  assert.equal(cleanup.deletedRecordings[0].id, recFailedOnly);

  assert.equal(db.getRecording(recFailedOnly), null);
  assert.ok(db.getRecording(recMixed));
  assert.equal(db.getMergeJob(failedJobId), null);
  assert.equal(db.getMergeJob(mixedFailedJobId), null);
  assert.ok(db.getMergeJob(mixedDoneJobId));

  db.close();
});
