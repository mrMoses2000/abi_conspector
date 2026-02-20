import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { AppDatabase } from '../../src/main/db/database.js';

describe('AppDatabase Integration', () => {
    let db;

    beforeEach(() => {
        // Use an in-memory SQLite database for fast, isolated testing
        db = new AppDatabase(':memory:');
    });

    afterEach(() => {
        // Close the database to release file handles
        db.db.close();
    });

    test('creates and retrieves a subject', () => {
        const subject = db.createSubject('Test Subject');
        assert.ok(subject.id.startsWith('subj_'));

        const subjects = db.listSubjects();
        assert.equal(subjects.length, 1);
        assert.equal(subjects[0].name, 'Test Subject');
        assert.equal(subjects[0].id, subject.id);
    });

    test('getSubjectByName works', () => {
        db.createSubject('Math');
        const subject = db.getSubjectByName('Math');
        assert.equal(subject.name, 'Math');

        const subjects = db.listSubjects();
        assert.equal(subjects.length, 1);
    });

    test('creates and retrieves a recording with subject', () => {
        const subject = db.createSubject('History');

        const recordingPayload = {
            sourceType: 'microphone',
            originalFileName: null,
            originalFilePath: null,
            managedAudioPath: '/fake/path/audio.webm',
            normalizedAudioPath: null,
            audioSha256: 'abcdef123456',
            subjectId: subject.id,
            durationSec: 120.5
        };

        const recId = db.createRecording(recordingPayload);
        assert.ok(recId.startsWith('rec_'));

        const recording = db.getRecording(recId);
        assert.equal(recording.id, recId);
        assert.equal(recording.source_type, 'microphone');
        assert.equal(recording.managed_audio_path, '/fake/path/audio.webm');
        assert.equal(recording.subject_id, subject.id);
        assert.equal(recording.llm_model, 'auto', 'Should default to auto');
        assert.equal(recording.duration_sec, 120.5);
    });

    test('updates recording LLM model', () => {
        const recId = db.createRecording({
            sourceType: 'microphone',
            originalFileName: null,
            originalFilePath: null,
            managedAudioPath: '/path',
            normalizedAudioPath: null,
            audioSha256: 'hash',
            subjectId: null,
            durationSec: 10
        });

        db.updateRecordingLlmModel(recId, 'gemini-2.5-flash');

        const recording = db.getRecording(recId);
        assert.equal(recording.llm_model, 'gemini-2.5-flash');
    });

    test('creates, updates, and completes a merge job', () => {
        const recId = db.createRecording({
            sourceType: 'microphone',
            originalFileName: null,
            originalFilePath: null,
            managedAudioPath: '/path',
            normalizedAudioPath: null,
            audioSha256: 'hash',
            subjectId: null,
            durationSec: 10
        });

        const jobId = db.createMergeJob({
            recordingId: recId,
            stage: 'stt',
            status: 'queued'
        });

        assert.ok(jobId.startsWith('job_'));

        let job = db.getMergeJob(jobId);
        assert.equal(job.stage, 'stt');
        assert.equal(job.status, 'queued');

        // Update stage
        db.updateMergeJob(jobId, 'llm_structure', 'running');
        job = db.getMergeJob(jobId);
        assert.equal(job.stage, 'llm_structure');
        assert.equal(job.status, 'running');

        // Fail job
        db.failMergeJob(jobId, 'stt_llm_structure', 'API_ERROR', 'Timeout');
        job = db.getMergeJob(jobId);
        assert.equal(job.status, 'failed');
        assert.equal(job.error_code, 'API_ERROR');
        assert.equal(job.error_message, 'Timeout');

        // Complete job
        db.completeMergeJob(jobId, 'Everything OK');
        job = db.getMergeJob(jobId);
        assert.equal(job.status, 'done');
        assert.equal(job.stage, 'done');
        assert.equal(job.warning, 'Everything OK');
    });

    test('deleting a recording cascades to merge_jobs', () => {
        // Setup: Create recording and a linked job
        const recId = db.createRecording({
            sourceType: 'microphone',
            originalFileName: null,
            originalFilePath: null,
            managedAudioPath: '/path',
            normalizedAudioPath: null,
            audioSha256: 'hash',
            subjectId: null,
            durationSec: 10
        });

        const jobId = db.createMergeJob({
            recordingId: recId,
            stage: 'stt',
            status: 'queued'
        });

        // Verify they exist
        assert.ok(db.getRecording(recId));
        assert.ok(db.getMergeJob(jobId));

        // Delete recording
        db.deleteRecording(recId);

        // Verify both are gone (FOREIGN KEY ON DELETE CASCADE)
        assert.equal(db.getRecording(recId), null);
        assert.equal(db.getMergeJob(jobId), null);
    });

});
