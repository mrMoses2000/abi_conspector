import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow } from 'electron';
import { AppDatabase } from './db/database.js';
import { getDatabasePath, getManagedPaths, getRuntimeConfig } from './config.js';
import { ensureDirs } from './utils/fs.js';
import { importAudioFile as importAudioFileWorkflow } from './audio/importAudio.js';
import { ingestManagedAudio } from './audio/ingestAudio.js';
import { MicrophoneRecorder } from './audio/microphoneRecorder.js';
import { createMergePipeline } from './pipeline/mergePipeline.js';
import { MergeQueue } from './pipeline/mergeQueue.js';
import { registerIpcHandlers } from './ipc/registerHandlers.js';
import { cleanupOldFiles } from './utils/retention.js';
import { writeMergedToNotion } from './workers/notionWorker.js';
import { ControlledError } from './utils/errors.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let db;
let mainWindow = null;
let ipcRegistered = false;
let recorder = null;

function normalizeEffort(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'low' || normalized === 'medium' || normalized === 'high') {
    return normalized;
  }
  throw new ControlledError('INVALID_CODEX_EFFORT', 'Codex effort must be low, medium, or high');
}

function cleanupOrphanSttWorkers() {
  if (process.platform === 'win32') {
    return;
  }

  const scriptPath = path.join(process.cwd(), 'scripts', 'run_stt_diarization.py');
  const result = spawnSync('pkill', ['-f', scriptPath], { encoding: 'utf8' });
  if (result.error) {
    console.warn(`[startup] could not run pkill for orphan STT workers: ${result.error.message}`);
    return;
  }

  if (result.status === 0) {
    console.warn('[startup] terminated orphan STT worker process(es)');
  }
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const existing = BrowserWindow.getAllWindows()[0];
    if (!existing) {
      return;
    }
    if (existing.isMinimized()) {
      existing.restore();
    }
    existing.focus();
  });
}

process.on('unhandledRejection', (reason) => {
  // Keep app process alive; failures are reflected in queue/job statuses.
  console.error('[unhandledRejection]', reason);
});

process.on('uncaughtException', (error) => {
  // Prevent hard crash loops; log and continue when possible.
  console.error('[uncaughtException]', error);
});

async function createMainWindow() {
  const window = new BrowserWindow({
    width: 1220,
    height: 840,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  window.on('closed', () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
  });

  await window.loadFile(path.join(__dirname, '../renderer/index.html'));
  mainWindow = window;
  return window;
}

async function safeUnlink(pathname) {
  if (!pathname) {
    return;
  }
  await fs.unlink(pathname).catch(() => {});
}

async function cleanupRecordingArtifacts(managedPaths, recordingRows) {
  for (const row of recordingRows) {
    const recordingId = row.id;
    await safeUnlink(row.managed_audio_path || '');
    await safeUnlink(row.normalized_audio_path || '');
    await safeUnlink(path.join(managedPaths.audio, `${recordingId}.flac`));
    await safeUnlink(path.join(managedPaths.transcripts, `${recordingId}.json`));
    await safeUnlink(path.join(managedPaths.transcripts, `${recordingId}.json.stt.log`));
    await safeUnlink(path.join(managedPaths.structured, `${recordingId}.md`));
    await safeUnlink(path.join(managedPaths.merged, `${recordingId}.md`));
    await safeUnlink(path.join(managedPaths.html, `${recordingId}.html`));
  }
}

if (gotSingleInstanceLock) {
  app.whenReady().then(async () => {
    cleanupOrphanSttWorkers();

    const managedPaths = getManagedPaths();
    const config = getRuntimeConfig();

    await ensureDirs([
      managedPaths.root,
      managedPaths.audio,
      managedPaths.imports,
      managedPaths.transcripts,
      managedPaths.structured,
      managedPaths.merged,
      managedPaths.html,
      managedPaths.backups
    ]);

    await cleanupOldFiles({
      directories: [managedPaths.audio, managedPaths.imports],
      days: 30
    });

    db = new AppDatabase(getDatabasePath());
    const recovered = db.recoverStaleJobs();
    if (recovered > 0) {
      console.warn(`[startup] recovered stale merge jobs: ${recovered}`);
    }

    const pipeline = createMergePipeline({
      db,
      managedPaths,
      runtimeConfig: config
    });

    const queue = new MergeQueue({
      worker: (jobId, notify) => pipeline.processJob(jobId, notify)
    });

    const micDeviceRaw = Number.parseInt(process.env.CONSPECTOR_MIC_DEVICE_INDEX || '', 10);
    recorder = new MicrophoneRecorder({
      managedImportsDir: managedPaths.imports,
      ffmpegBin: 'ffmpeg',
      darwinDeviceIndex: Number.isFinite(micDeviceRaw) ? micDeviceRaw : null
    });

    const writebackNotion = async ({ recordingId, pageTitle }) => {
      const recording = db.getRecording(recordingId);
      if (!recording) {
        throw new ControlledError('RECORDING_NOT_FOUND', `Recording not found: ${recordingId}`);
      }

      const mergedPath = path.join(managedPaths.merged, `${recording.id}.md`);
      await fs.access(mergedPath).catch(() => {
        throw new ControlledError('MERGED_NOTE_NOT_FOUND', `Merged markdown not found: ${mergedPath}`);
      });

      const notionConfig = {
        ...config.notion,
        mode: 'real',
        pageTitle: typeof pageTitle === 'string' && pageTitle.trim() ? pageTitle.trim() : config.notion.pageTitle
      };

      return writeMergedToNotion({
        mergedPath,
        recording,
        backupsDir: managedPaths.backups,
        notionConfig
      });
    };

    const cleanupFailedJobs = async () => {
      const result = db.cleanupFailedJobs();
      await cleanupRecordingArtifacts(managedPaths, result.deletedRecordings || []);
      return {
        deletedJobs: result.deletedJobs || 0,
        deletedRecordings: (result.deletedRecordings || []).length
      };
    };

    const getCodexSettings = () => ({
      model: config.codex.model || '',
      reasoningEffort: config.codex.reasoningEffort || 'medium',
      fullAuto: Boolean(config.codex.fullAuto)
    });

    const updateCodexSettings = ({ reasoningEffort }) => {
      if (reasoningEffort !== undefined) {
        config.codex.reasoningEffort = normalizeEffort(reasoningEffort);
      }
      return getCodexSettings();
    };

    if (!ipcRegistered) {
      registerIpcHandlers({
        getWindow: () => mainWindow,
        db,
        queue,
        managedPaths,
        importAudioFile: ({ path: inputPath }) =>
          importAudioFileWorkflow({
            inputPath,
            db,
            managedPaths,
            maxLectureSeconds: config.maxLectureSeconds,
            queue
          }),
        startMicrophoneRecording: () => recorder.start(),
        stopMicrophoneRecording: async () => {
          const stopped = await recorder.stop();
          const imported = await ingestManagedAudio({
            managedAudioPath: stopped.recordingPath,
            sourceType: 'microphone',
            originalFileName: path.basename(stopped.recordingPath),
            originalFilePath: null,
            db,
            maxLectureSeconds: config.maxLectureSeconds,
            queue,
            cleanupOnError: true
          });

          if (stopped.warning) {
            imported.warning = imported.warning ? `${imported.warning} ${stopped.warning}` : stopped.warning;
          }

          return imported;
        },
        getRecorderState: () => recorder.getState(),
        getCodexSettings,
        updateCodexSettings,
        writebackNotion,
        cleanupFailedJobs
      });
      ipcRegistered = true;
    }

    await createMainWindow();

    app.on('activate', async () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        await createMainWindow();
      }
    });

  }).catch((error) => {
    console.error('[app.whenReady] fatal startup error', error);
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (db) {
    db.close();
  }

  if (recorder && recorder.isRecording()) {
    recorder.forceStop();
  }
});
