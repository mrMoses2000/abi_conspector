export const IPC_CHANNELS = {
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

/**
 * @typedef {Object} AudioImportRequest
 * @property {string} path
 */

/**
 * @typedef {Object} AudioImportedEvent
 * @property {string} recordingId
 * @property {string} managedAudioPath
 * @property {number} durationSec
 * @property {string} originalFilename
 * @property {'queued'|'running'|'done'|'failed'} normalizationStatus
 */

/**
 * @typedef {Object} AudioImportFailedEvent
 * @property {string} code
 * @property {string} message
 */

/**
 * @typedef {Object} NotionWritebackError
 * @property {string} code
 * @property {string} message
 * @property {Record<string, any>=} details
 */

/**
 * @typedef {Object} NotionWritebackResult
 * @property {boolean} ok
 * @property {string=} status
 * @property {string=} warning
 * @property {string=} pageId
 * @property {number=} blocksWritten
 * @property {string=} backupPath
 * @property {string=} logPath
 * @property {NotionWritebackError=} error
 */
