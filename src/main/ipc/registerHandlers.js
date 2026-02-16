import fs from 'node:fs/promises';
import path from 'node:path';
import { dialog, ipcMain, shell } from 'electron';
import { ControlledError, asIpcError } from '../utils/errors.js';
import { IPC_CHANNELS } from '../../shared/ipc-contract.js';

/**
 * @param {{
 *   getWindow: () => import('electron').BrowserWindow | null;
 *   importAudioFile: (payload: { path: string }) => Promise<any>;
 *   startMicrophoneRecording: () => Promise<any>;
 *   stopMicrophoneRecording: () => Promise<any>;
 *   getRecorderState: () => any;
 *   getCodexSettings: () => { model: string; reasoningEffort: string; fullAuto: boolean; };
 *   updateCodexSettings: (payload: { reasoningEffort?: string; }) => { model: string; reasoningEffort: string; fullAuto: boolean; };
 *   writebackNotion: (payload: { recordingId: string; pageTitle?: string }) => Promise<any>;
 *   cleanupFailedJobs: () => Promise<{ deletedJobs: number; deletedRecordings: number; }>;
 *   db: import('../db/database.js').AppDatabase;
 *   queue: import('../pipeline/mergeQueue.js').MergeQueue;
 *   managedPaths: ReturnType<import('../config.js').getManagedPaths>;
 * }} deps
 */
export function registerIpcHandlers(deps) {
  const {
    getWindow,
    importAudioFile,
    startMicrophoneRecording,
    stopMicrophoneRecording,
    getRecorderState,
    getCodexSettings,
    updateCodexSettings,
    writebackNotion,
    cleanupFailedJobs,
    db,
    queue,
    managedPaths
  } = deps;

  const sendToRenderer = (channel, payload) => {
    const window = getWindow();
    if (!window || window.isDestroyed()) {
      return;
    }
    window.webContents.send(channel, payload);
  };

  ipcMain.handle(IPC_CHANNELS.AUDIO_PICK, async () => {
    const window = getWindow();
    const result = await dialog.showOpenDialog(window, {
      title: 'Выберите аудио/видео файл',
      properties: ['openFile'],
      filters: [
        {
          name: 'Media',
          extensions: ['mp3', 'wav', 'm4a', 'flac', 'aac', 'ogg', 'mp4', 'mkv', 'mov', 'webm']
        },
        { name: 'All Files', extensions: ['*'] }
      ]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true, path: null };
    }

    return { canceled: false, path: result.filePaths[0] };
  });

  ipcMain.handle(IPC_CHANNELS.AUDIO_IMPORT, async (_event, payload) => {
    try {
      const imported = await importAudioFile({ path: payload?.path });
      sendToRenderer(IPC_CHANNELS.AUDIO_IMPORTED, imported);
      return imported;
    } catch (error) {
      const ipcError = asIpcError(error);
      sendToRenderer(IPC_CHANNELS.AUDIO_IMPORT_FAILED, ipcError);
      throw new Error(`${ipcError.code}: ${ipcError.message}`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.RECORDER_START, async () => {
    try {
      const state = await startMicrophoneRecording();
      sendToRenderer(IPC_CHANNELS.RECORDER_STATE, state);
      return state;
    } catch (error) {
      const ipcError = asIpcError(error);
      throw new Error(`${ipcError.code}: ${ipcError.message}`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.RECORDER_STOP, async () => {
    try {
      const imported = await stopMicrophoneRecording();
      sendToRenderer(IPC_CHANNELS.RECORDER_STATE, getRecorderState());
      sendToRenderer(IPC_CHANNELS.AUDIO_IMPORTED, imported);
      return imported;
    } catch (error) {
      const ipcError = asIpcError(error);
      sendToRenderer(IPC_CHANNELS.AUDIO_IMPORT_FAILED, ipcError);
      throw new Error(`${ipcError.code}: ${ipcError.message}`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.JOBS_LIST, async () => {
    return db.listRecentJobs(100);
  });

  ipcMain.handle(IPC_CHANNELS.JOBS_CLEANUP_FAILED, async () => {
    return cleanupFailedJobs();
  });

  ipcMain.handle(IPC_CHANNELS.CODEX_SETTINGS_GET, async () => {
    return getCodexSettings();
  });

  ipcMain.handle(IPC_CHANNELS.CODEX_SETTINGS_UPDATE, async (_event, payload) => {
    return updateCodexSettings({
      reasoningEffort: payload?.reasoningEffort
    });
  });

  ipcMain.handle(IPC_CHANNELS.JOB_RETRY, async (_event, payload) => {
    const jobId = payload?.jobId;
    if (!jobId || typeof jobId !== 'string') {
      throw new ControlledError('INVALID_JOB_ID', 'jobId is required');
    }

    const existingJob = db.getMergeJob(jobId);
    if (!existingJob) {
      throw new ControlledError('JOB_NOT_FOUND', `Merge job not found: ${jobId}`);
    }

    const recording = db.getRecording(existingJob.recording_id);
    if (!recording) {
      throw new ControlledError('RECORDING_NOT_FOUND', `Recording not found: ${existingJob.recording_id}`);
    }

    const retryJobId = db.createMergeJob({
      recordingId: recording.id,
      stage: 'normalize_audio',
      status: 'queued',
      warning: null
    });

    queue.enqueue(retryJobId);
    return db.getMergeJob(retryJobId);
  });

  ipcMain.handle(IPC_CHANNELS.DATA_OPEN, async () => {
    const error = await shell.openPath(managedPaths.root);
    if (error) {
      throw new ControlledError('OPEN_PATH_FAILED', error);
    }
    return { ok: true, path: managedPaths.root };
  });

  ipcMain.handle(IPC_CHANNELS.RESULT_OPEN, async (_event, payload) => {
    const recordingId = payload?.recordingId;
    const kind = payload?.kind;

    if (!recordingId || typeof recordingId !== 'string') {
      throw new ControlledError('INVALID_RECORDING_ID', 'recordingId is required');
    }

    const recording = db.getRecording(recordingId);
    if (!recording) {
      throw new ControlledError('RECORDING_NOT_FOUND', `Recording not found: ${recordingId}`);
    }

    const resultPath = resolveResultPath(managedPaths, recordingId, kind);
    await fs.access(resultPath).catch(() => {
      throw new ControlledError('RESULT_NOT_FOUND', `Result file does not exist: ${resultPath}`);
    });

    const error = await shell.openPath(resultPath);
    if (error) {
      throw new ControlledError('OPEN_PATH_FAILED', error);
    }

    return { ok: true, path: resultPath };
  });

  ipcMain.handle(IPC_CHANNELS.NOTION_WRITEBACK, async (_event, payload) => {
    const recordingId = payload?.recordingId;
    const pageTitle = payload?.pageTitle;

    if (!recordingId || typeof recordingId !== 'string') {
      throw new ControlledError('INVALID_RECORDING_ID', 'recordingId is required');
    }

    return writebackNotion({ recordingId, pageTitle });
  });

  const forward = (channel) => {
    queue.on(channel, (payload) => {
      sendToRenderer(channel, payload);
    });
  };

  forward(IPC_CHANNELS.QUEUE_UPDATED);
  forward('job:started');
  forward(IPC_CHANNELS.JOB_UPDATED);
  forward('job:finished');
  forward('job:failed');

  sendToRenderer(IPC_CHANNELS.RECORDER_STATE, getRecorderState());
}

function resolveResultPath(managedPaths, recordingId, kind) {
  switch (kind) {
    case 'html':
      return path.join(managedPaths.html, `${recordingId}.html`);
    case 'markdown':
      return path.join(managedPaths.merged, `${recordingId}.md`);
    case 'structured':
      return path.join(managedPaths.structured, `${recordingId}.md`);
    case 'transcript':
      return path.join(managedPaths.transcripts, `${recordingId}.json`);
    default:
      throw new ControlledError('INVALID_RESULT_KIND', `Unsupported result kind: ${String(kind)}`);
  }
}
