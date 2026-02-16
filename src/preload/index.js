const { contextBridge, ipcRenderer } = require('electron');
const IPC_CHANNELS = {
  AUDIO_PICK: 'audio:pick',
  AUDIO_IMPORT: 'audio:import',
  AUDIO_IMPORTED: 'audio:imported',
  AUDIO_IMPORT_FAILED: 'audio:import:failed',
  RECORDER_START: 'recorder:start',
  RECORDER_STOP: 'recorder:stop',
  RECORDER_STATE: 'recorder:state',
  JOBS_LIST: 'jobs:list',
  JOBS_CLEANUP_FAILED: 'jobs:cleanup:failed',
  JOB_RETRY: 'job:retry',
  CODEX_SETTINGS_GET: 'codex:settings:get',
  CODEX_SETTINGS_UPDATE: 'codex:settings:update',
  RESULT_OPEN: 'result:open',
  DATA_OPEN: 'data:open',
  NOTION_WRITEBACK: 'notion:writeback',
  QUEUE_UPDATED: 'queue:updated',
  JOB_UPDATED: 'job:updated'
};

contextBridge.exposeInMainWorld('conspectorApi', {
  pickAudio: () => ipcRenderer.invoke(IPC_CHANNELS.AUDIO_PICK),
  importAudio: (path) => ipcRenderer.invoke(IPC_CHANNELS.AUDIO_IMPORT, { path }),
  startRecording: () => ipcRenderer.invoke(IPC_CHANNELS.RECORDER_START),
  stopRecording: () => ipcRenderer.invoke(IPC_CHANNELS.RECORDER_STOP),
  listJobs: () => ipcRenderer.invoke(IPC_CHANNELS.JOBS_LIST),
  cleanupFailedJobs: () => ipcRenderer.invoke(IPC_CHANNELS.JOBS_CLEANUP_FAILED),
  retryJob: (jobId) => ipcRenderer.invoke(IPC_CHANNELS.JOB_RETRY, { jobId }),
  getCodexSettings: () => ipcRenderer.invoke(IPC_CHANNELS.CODEX_SETTINGS_GET),
  updateCodexSettings: (payload) => ipcRenderer.invoke(IPC_CHANNELS.CODEX_SETTINGS_UPDATE, payload),
  openResult: (recordingId, kind) => ipcRenderer.invoke(IPC_CHANNELS.RESULT_OPEN, { recordingId, kind }),
  openDataFolder: () => ipcRenderer.invoke(IPC_CHANNELS.DATA_OPEN),
  writebackNotion: (recordingId, pageTitle = '') =>
    ipcRenderer.invoke(IPC_CHANNELS.NOTION_WRITEBACK, { recordingId, pageTitle }),

  onAudioImported: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on(IPC_CHANNELS.AUDIO_IMPORTED, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.AUDIO_IMPORTED, listener);
  },

  onAudioImportFailed: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on(IPC_CHANNELS.AUDIO_IMPORT_FAILED, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.AUDIO_IMPORT_FAILED, listener);
  },

  onQueueUpdated: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on(IPC_CHANNELS.QUEUE_UPDATED, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.QUEUE_UPDATED, listener);
  },

  onJobUpdated: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on(IPC_CHANNELS.JOB_UPDATED, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.JOB_UPDATED, listener);
  },

  onRecorderState: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on(IPC_CHANNELS.RECORDER_STATE, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.RECORDER_STATE, listener);
  }
});
