import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { AppDatabase } from '../src/main/db/database.js';
import { importAudioFile } from '../src/main/audio/importAudio.js';

async function makeWorkspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'abi-import-test-'));
  const managedPaths = {
    root,
    audio: path.join(root, 'audio'),
    imports: path.join(root, 'imports'),
    transcripts: path.join(root, 'transcripts'),
    structured: path.join(root, 'structured'),
    merged: path.join(root, 'merged'),
    html: path.join(root, 'html'),
    backups: path.join(root, 'backups')
  };

  await Promise.all(Object.values(managedPaths).map((dir) => fs.mkdir(dir, { recursive: true })));
  return { root, managedPaths };
}

test('importAudioFile imports local audio and enqueues normalize stage', async (t) => {
  const { root, managedPaths } = await makeWorkspace();
  const db = new AppDatabase(path.join(root, 'app.db'));

  const sourcePath = path.join(root, 'source.wav');
  const ffmpeg = spawnSync(
    'ffmpeg',
    ['-y', '-f', 'lavfi', '-i', 'sine=frequency=500:duration=1', '-ac', '1', '-ar', '16000', sourcePath],
    { encoding: 'utf8' }
  );

  if (ffmpeg.status !== 0) {
    db.close();
    t.skip('ffmpeg is required for this test');
    return;
  }

  const queued = [];
  const result = await importAudioFile({
    inputPath: sourcePath,
    db,
    managedPaths,
    maxLectureSeconds: 3 * 60 * 60,
    queue: {
      enqueue: (jobId) => queued.push(jobId)
    }
  });

  assert.equal(result.originalFilename, 'source.wav');
  assert.equal(result.normalizationStatus, 'queued');
  assert.equal(queued.length, 1);

  const recording = db.getRecording(result.recordingId);
  assert.equal(recording.source_type, 'imported_file');
  assert.equal(recording.normalized_audio_path, null);

  db.close();
});

test('importAudioFile returns controlled error for non-audio file', async () => {
  const { root, managedPaths } = await makeWorkspace();
  const db = new AppDatabase(path.join(root, 'app.db'));

  const sourcePath = path.join(root, 'not-audio.txt');
  await fs.writeFile(sourcePath, 'hello', 'utf8');

  let caught;
  try {
    await importAudioFile({
      inputPath: sourcePath,
      db,
      managedPaths,
      maxLectureSeconds: 3 * 60 * 60,
      queue: {
        enqueue: () => {
          throw new Error('must not enqueue');
        }
      }
    });
  } catch (error) {
    caught = error;
  }

  assert.ok(caught);
  assert.ok(caught.code);
  assert.ok(
    ['NO_AUDIO_STREAM', 'FFMPEG_PROCESS_FAILED', 'FFPROBE_PARSE_ERROR', 'FFPROBE_NOT_FOUND'].includes(caught.code)
  );

  db.close();
});
