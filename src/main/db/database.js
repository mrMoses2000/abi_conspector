import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';

function nowIso() {
  return new Date().toISOString();
}

function randomId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

export class AppDatabase {
  /**
   * @param {string} dbPath
   */
  constructor(dbPath) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode=WAL;');
    this.db.exec('PRAGMA foreign_keys=ON;');
    this.#migrate();

    this.insertRecordingStmt = this.db.prepare(`
      INSERT INTO recordings (
        id,
        source_type,
        original_file_name,
        original_file_path,
        managed_audio_path,
        normalized_audio_path,
        audio_sha256,
        duration_sec,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.updateRecordingNormalizationStmt = this.db.prepare(`
      UPDATE recordings
      SET normalized_audio_path = ?, updated_at = ?
      WHERE id = ?
    `);

    this.insertMergeJobStmt = this.db.prepare(`
      INSERT INTO merge_jobs (
        id,
        recording_id,
        stage,
        status,
        warning,
        error_code,
        error_message,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.updateMergeJobStageStmt = this.db.prepare(`
      UPDATE merge_jobs
      SET stage = ?, status = ?, warning = ?, updated_at = ?
      WHERE id = ?
    `);

    this.failMergeJobStmt = this.db.prepare(`
      UPDATE merge_jobs
      SET stage = ?, status = 'failed', error_code = ?, error_message = ?, updated_at = ?
      WHERE id = ?
    `);

    this.completeMergeJobStmt = this.db.prepare(`
      UPDATE merge_jobs
      SET stage = 'done', status = 'done', warning = ?, updated_at = ?
      WHERE id = ?
    `);

    this.getMergeJobStmt = this.db.prepare(`
      SELECT id, recording_id, stage, status, warning, error_code, error_message, created_at, updated_at
      FROM merge_jobs
      WHERE id = ?
    `);

    this.getRecordingStmt = this.db.prepare(`
      SELECT
        id,
        source_type,
        original_file_name,
        original_file_path,
        managed_audio_path,
        normalized_audio_path,
        audio_sha256,
        duration_sec,
        created_at,
        updated_at
      FROM recordings
      WHERE id = ?
    `);

    this.listRecentJobsStmt = this.db.prepare(`
      SELECT
        j.id,
        j.recording_id,
        j.stage,
        j.status,
        j.warning,
        j.error_code,
        j.error_message,
        j.created_at,
        j.updated_at,
        r.source_type,
        r.original_file_name,
        r.duration_sec
      FROM merge_jobs j
      INNER JOIN recordings r ON r.id = j.recording_id
      ORDER BY j.created_at DESC
      LIMIT ?
    `);
  }

  close() {
    this.db.close();
  }

  #migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS recordings (
        id TEXT PRIMARY KEY,
        source_type TEXT NOT NULL CHECK (source_type IN ('microphone', 'imported_file')),
        original_file_name TEXT,
        original_file_path TEXT,
        managed_audio_path TEXT NOT NULL,
        normalized_audio_path TEXT,
        audio_sha256 TEXT NOT NULL,
        duration_sec REAL NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS merge_jobs (
        id TEXT PRIMARY KEY,
        recording_id TEXT NOT NULL,
        stage TEXT NOT NULL,
        status TEXT NOT NULL,
        warning TEXT,
        error_code TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (recording_id) REFERENCES recordings(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_merge_jobs_recording_id ON merge_jobs(recording_id);
      CREATE INDEX IF NOT EXISTS idx_merge_jobs_status ON merge_jobs(status);
    `);

    this.#ensureRecordingColumns();
    this.#ensureMergeJobColumns();
  }

  #tableColumns(tableName) {
    const rows = this.db.prepare(`PRAGMA table_info(${tableName});`).all();
    return new Set(rows.map((row) => row.name));
  }

  #ensureRecordingColumns() {
    const columns = this.#tableColumns('recordings');
    const additions = [
      ['source_type', "ALTER TABLE recordings ADD COLUMN source_type TEXT NOT NULL DEFAULT 'microphone' CHECK (source_type IN ('microphone', 'imported_file'));"],
      ['original_file_name', 'ALTER TABLE recordings ADD COLUMN original_file_name TEXT;'],
      ['original_file_path', 'ALTER TABLE recordings ADD COLUMN original_file_path TEXT;'],
      ['normalized_audio_path', 'ALTER TABLE recordings ADD COLUMN normalized_audio_path TEXT;'],
      ['audio_sha256', "ALTER TABLE recordings ADD COLUMN audio_sha256 TEXT NOT NULL DEFAULT '';"]
    ];

    for (const [name, sql] of additions) {
      if (!columns.has(name)) {
        this.db.exec(sql);
      }
    }
  }

  #ensureMergeJobColumns() {
    const columns = this.#tableColumns('merge_jobs');
    const additions = [
      ['warning', 'ALTER TABLE merge_jobs ADD COLUMN warning TEXT;'],
      ['error_code', 'ALTER TABLE merge_jobs ADD COLUMN error_code TEXT;'],
      ['error_message', 'ALTER TABLE merge_jobs ADD COLUMN error_message TEXT;']
    ];

    for (const [name, sql] of additions) {
      if (!columns.has(name)) {
        this.db.exec(sql);
      }
    }
  }

  /**
   * @param {{
   *   sourceType: 'microphone' | 'imported_file';
   *   originalFileName: string | null;
   *   originalFilePath: string | null;
   *   managedAudioPath: string;
   *   normalizedAudioPath: string | null;
   *   audioSha256: string;
   *   durationSec: number;
   * }} payload
   */
  createRecording(payload) {
    const id = randomId('rec');
    const now = nowIso();
    this.insertRecordingStmt.run(
      id,
      payload.sourceType,
      payload.originalFileName,
      payload.originalFilePath,
      payload.managedAudioPath,
      payload.normalizedAudioPath,
      payload.audioSha256,
      payload.durationSec,
      now,
      now
    );
    return id;
  }

  /**
   * @param {string} recordingId
   * @param {string} normalizedAudioPath
   */
  updateRecordingNormalization(recordingId, normalizedAudioPath) {
    this.updateRecordingNormalizationStmt.run(normalizedAudioPath, nowIso(), recordingId);
  }

  /**
   * @param {{ recordingId: string; stage: string; status: string; warning?: string | null; }} payload
   */
  createMergeJob(payload) {
    const id = randomId('job');
    const now = nowIso();
    this.insertMergeJobStmt.run(
      id,
      payload.recordingId,
      payload.stage,
      payload.status,
      payload.warning ?? null,
      null,
      null,
      now,
      now
    );
    return id;
  }

  /**
   * @param {string} jobId
   * @param {string} stage
   * @param {'queued' | 'running' | 'done'} status
   * @param {string | null} warning
   */
  updateMergeJob(jobId, stage, status, warning = null) {
    this.updateMergeJobStageStmt.run(stage, status, warning, nowIso(), jobId);
  }

  /**
   * @param {string} jobId
   * @param {string} stage
   * @param {string} code
   * @param {string} message
   */
  failMergeJob(jobId, stage, code, message) {
    this.failMergeJobStmt.run(stage, code, message, nowIso(), jobId);
  }

  /**
   * @param {string} jobId
   * @param {string | null} warning
   */
  completeMergeJob(jobId, warning = null) {
    this.completeMergeJobStmt.run(warning, nowIso(), jobId);
  }

  /**
   * @param {string} jobId
   */
  getMergeJob(jobId) {
    return this.getMergeJobStmt.get(jobId) ?? null;
  }

  /**
   * @param {string} recordingId
   */
  getRecording(recordingId) {
    return this.getRecordingStmt.get(recordingId) ?? null;
  }

  /**
   * @param {number} limit
   */
  listRecentJobs(limit = 30) {
    return this.listRecentJobsStmt.all(limit);
  }
}
