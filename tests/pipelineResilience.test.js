import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { AppDatabase } from '../src/main/db/database.js';
import { createMergePipeline } from '../src/main/pipeline/mergePipeline.js';

async function makeWorkspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'abi-pipeline-resilience-'));
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

test('pipeline falls back to mock workers when real STT/Codex fail', async (t) => {
  const { root, managedPaths } = await makeWorkspace();

  const sourcePath = path.join(root, 'source.wav');
  const gen = spawnSync(
    'ffmpeg',
    ['-y', '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=1', '-ac', '1', '-ar', '16000', sourcePath],
    { encoding: 'utf8' }
  );

  if (gen.status !== 0) {
    t.skip('ffmpeg is required for resilience pipeline test');
    return;
  }

  const db = new AppDatabase(path.join(root, 'app.db'));
  const recordingId = db.createRecording({
    sourceType: 'imported_file',
    originalFileName: 'source.wav',
    originalFilePath: sourcePath,
    managedAudioPath: sourcePath,
    normalizedAudioPath: null,
    audioSha256: 'sha',
    durationSec: 1
  });

  const jobId = db.createMergeJob({
    recordingId,
    stage: 'normalize_audio',
    status: 'queued',
    warning: null
  });

  const pipeline = createMergePipeline({
    db,
    managedPaths,
    runtimeConfig: {
      ffmpeg: {
        sampleRateHz: 16000,
        channels: 1,
        format: 'flac'
      },
      stt: {
        mode: 'real',
        pythonBin: 'python-does-not-exist',
        scriptPath: path.join(process.cwd(), 'scripts', 'run_stt_diarization.py'),
        model: 'medium',
        language: 'ru',
        device: 'cpu',
        computeType: 'int8',
        batchSize: 8,
        hfToken: '',
        requireDiarization: true,
        timeoutMs: 1000
      },
      codex: {
        mode: 'real',
        model: '',
        timeoutMs: 1000,
        workdir: '/this/path/does/not/exist',
        sourceNotePath: ''
      },
      notion: {
        mode: 'off',
        token: '',
        pageId: '',
        pageTitle: ''
      },
      resilience: {
        sttFallbackToMock: true,
        codexFallbackToMock: true,
        notionSoftFail: true,
        continueWithoutHtml: true,
        preflightStrict: false
      }
    }
  });

  await pipeline.processJob(jobId, () => {});

  const job = db.getMergeJob(jobId);
  assert.equal(job.status, 'done');
  assert.equal(job.stage, 'done');
  assert.ok(job.warning);
  assert.match(job.warning, /fallback/i);

  await fs.access(path.join(managedPaths.transcripts, `${recordingId}.json`));
  await fs.access(path.join(managedPaths.structured, `${recordingId}.md`));
  await fs.access(path.join(managedPaths.merged, `${recordingId}.md`));
  await fs.access(path.join(managedPaths.html, `${recordingId}.html`));

  db.close();
});
