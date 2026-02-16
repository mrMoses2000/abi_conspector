import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { AppDatabase } from '../src/main/db/database.js';

function tableColumns(db, tableName) {
  return db.prepare(`PRAGMA table_info(${tableName});`).all().map((row) => row.name);
}

test('database migration adds missing columns for old local schema', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'abi-migration-test-'));
  const dbPath = path.join(root, 'app.db');

  const raw = new DatabaseSync(dbPath);
  raw.exec(`
    CREATE TABLE recordings (
      id TEXT PRIMARY KEY,
      managed_audio_path TEXT NOT NULL,
      duration_sec REAL NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE merge_jobs (
      id TEXT PRIMARY KEY,
      recording_id TEXT NOT NULL,
      stage TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  raw.close();

  const db = new AppDatabase(dbPath);

  const recordingCols = tableColumns(db.db, 'recordings');
  const mergeCols = tableColumns(db.db, 'merge_jobs');

  assert.ok(recordingCols.includes('source_type'));
  assert.ok(recordingCols.includes('original_file_name'));
  assert.ok(recordingCols.includes('original_file_path'));
  assert.ok(recordingCols.includes('normalized_audio_path'));
  assert.ok(recordingCols.includes('audio_sha256'));

  assert.ok(mergeCols.includes('warning'));
  assert.ok(mergeCols.includes('error_code'));
  assert.ok(mergeCols.includes('error_message'));

  db.close();
});
