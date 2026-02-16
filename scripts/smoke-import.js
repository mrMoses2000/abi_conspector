#!/usr/bin/env node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { AppDatabase } from '../src/main/db/database.js';
import { createMergePipeline } from '../src/main/pipeline/mergePipeline.js';
import { MergeQueue } from '../src/main/pipeline/mergeQueue.js';
import { importAudioFile } from '../src/main/audio/importAudio.js';

function log(msg) {
  process.stdout.write(`${msg}\n`);
}

function ensureFfmpeg() {
  const probe = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
  if (probe.error || probe.status !== 0) {
    throw new Error('ffmpeg not found');
  }
}

async function makeWorkspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'abi-smoke-'));
  const managed = {
    root,
    audio: path.join(root, 'audio'),
    imports: path.join(root, 'imports'),
    transcripts: path.join(root, 'transcripts'),
    structured: path.join(root, 'structured'),
    merged: path.join(root, 'merged'),
    html: path.join(root, 'html'),
    backups: path.join(root, 'backups')
  };
  await Promise.all(Object.values(managed).map((dir) => fs.mkdir(dir, { recursive: true })));
  return managed;
}

async function main() {
  ensureFfmpeg();

  const managedPaths = await makeWorkspace();
  const dbPath = path.join(managedPaths.root, 'app.db');
  const db = new AppDatabase(dbPath);

  const source = path.join(managedPaths.root, 'sample.wav');
  const gen = spawnSync(
    'ffmpeg',
    ['-y', '-f', 'lavfi', '-i', 'sine=frequency=700:duration=2', '-ac', '1', '-ar', '16000', source],
    { encoding: 'utf8' }
  );
  if (gen.status !== 0) {
    throw new Error(gen.stderr || 'failed to generate sample audio');
  }

  const pipeline = createMergePipeline({
    db,
    managedPaths,
    runtimeConfig: {
      ffmpeg: {
        sampleRateHz: 16_000,
        channels: 1,
        format: 'flac'
      },
      stt: {
        mode: 'mock',
        pythonBin: 'python3',
        scriptPath: '',
        model: 'medium',
        language: 'ru',
        device: 'cpu',
        computeType: 'int8',
        batchSize: 8,
        hfToken: '',
        requireDiarization: true,
        timeoutMs: 1_000
      },
      codex: {
        mode: 'mock',
        model: '',
        timeoutMs: 1_000,
        workdir: process.cwd(),
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

  const queue = new MergeQueue({
    worker: (jobId, notify) => pipeline.processJob(jobId, notify)
  });

  let done = false;
  let failed = false;
  let lastJobId = null;

  queue.on('job:started', ({ jobId }) => {
    lastJobId = jobId;
    log(`job started: ${jobId}`);
  });

  queue.on('job:updated', ({ stage, status }) => {
    log(`stage ${stage} => ${status}`);
  });

  queue.on('job:finished', ({ jobId }) => {
    done = true;
    lastJobId = jobId;
    log(`job finished: ${jobId}`);
  });

  queue.on('job:failed', ({ jobId, error }) => {
    failed = true;
    lastJobId = jobId;
    log(`job failed: ${jobId} (${error})`);
  });

  const imported = await importAudioFile({
    inputPath: source,
    db,
    managedPaths,
    maxLectureSeconds: 3 * 60 * 60,
    queue
  });
  log(`imported: ${imported.recordingId}`);

  const started = Date.now();
  while (!done && !failed && Date.now() - started < 30_000) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  if (failed) {
    throw new Error(`queue failed for ${lastJobId}`);
  }
  if (!done) {
    throw new Error('queue timeout');
  }

  const recording = db.getRecording(imported.recordingId);
  const job = db.getMergeJob(lastJobId);

  if (!recording?.normalized_audio_path) {
    throw new Error('normalized audio path was not written');
  }

  if (!job || job.status !== 'done') {
    throw new Error('job did not reach done status');
  }

  const merged = path.join(managedPaths.merged, `${imported.recordingId}.md`);
  const html = path.join(managedPaths.html, `${imported.recordingId}.html`);
  await fs.access(merged);
  await fs.access(html);

  log(`artifacts: ${merged}`);
  log(`artifacts: ${html}`);
  log('smoke import passed');

  db.close();
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
