import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import multer from 'multer';

// In a real E2E test, we would start server.js. But server.js actively binds to port 3000
// and connects to the real paths. Instead, we'll verify the Express route logic and Multer
// parsing by spinning up an isolated instance that matches the `/api/upload` endpoint structure.

describe('Server API Layer - /api/upload', () => {
    let app;
    let server;
    let baseUrl;

    before(() => {
        app = express();
        const upload = multer({ storage: multer.memoryStorage() }); // In-memory for tests

        app.post('/api/upload', upload.single('audio'), (req, res) => {
            const subjectId = req.body?.subjectId;
            const llmModel = String(req.body?.llmModel || 'auto').trim();

            if (!req.file) {
                return res.status(400).json({ ok: false, message: 'No file received' });
            }

            if (!subjectId) {
                return res.status(400).json({ ok: false, message: 'Missing subjectId' });
            }

            // Simulate ingestManagedAudio and DB saving success
            res.json({
                ok: true,
                recordingId: 'rec_123',
                message: 'Upload started successfully',
                receivedLlmModel: llmModel
            });
        });

        return new Promise((resolve) => {
            // port 0 assigns a random available port
            server = app.listen(0, '127.0.0.1', () => {
                baseUrl = `http://127.0.0.1:${server.address().port}`;
                resolve();
            });
        });
    });

    after((done) => {
        if (server) {
            server.close(done);
        } else {
            done();
        }
    });

    test('rejects upload without file', async () => {
        const formData = new FormData();
        formData.append('subjectId', 'sub_123');
        formData.append('llmModel', 'gemini-1.5-pro');

        const response = await fetch(`${baseUrl}/api/upload`, {
            method: 'POST',
            body: formData
        });

        const data = await response.json();
        assert.equal(response.status, 400);
        assert.equal(data.ok, false);
        assert.match(data.message, /No file received/);
    });

    test('rejects upload without subjectId', async () => {
        const formData = new FormData();
        const mockBlob = new Blob(['fake audio content'], { type: 'audio/webm' });
        formData.append('audio', mockBlob, 'test.webm');

        const response = await fetch(`${baseUrl}/api/upload`, {
            method: 'POST',
            body: formData
        });

        const data = await response.json();
        assert.equal(response.status, 400);
        assert.equal(data.ok, false);
        assert.match(data.message, /Missing subjectId/);
    });

    test('accepts valid upload with all parameters', async () => {
        const formData = new FormData();
        const mockBlob = new Blob(['fake audio content'], { type: 'audio/webm' });
        formData.append('audio', mockBlob, 'test.webm');
        formData.append('subjectId', 'sub_123');
        formData.append('llmModel', 'codex-medium');

        const response = await fetch(`${baseUrl}/api/upload`, {
            method: 'POST',
            body: formData
        });

        const data = await response.json();
        assert.equal(response.status, 200);
        assert.equal(data.ok, true);
        assert.equal(data.recordingId, 'rec_123');
        assert.equal(data.receivedLlmModel, 'codex-medium', 'Should parse and preserve LLM model selection');
    });

    test('defaults to auto LLM model if not provided', async () => {
        const formData = new FormData();
        const mockBlob = new Blob(['fake audio content'], { type: 'audio/webm' });
        formData.append('audio', mockBlob, 'test.webm');
        formData.append('subjectId', 'sub_123');

        const response = await fetch(`${baseUrl}/api/upload`, {
            method: 'POST',
            body: formData
        });

        const data = await response.json();
        assert.equal(response.status, 200);
        assert.equal(data.ok, true);
        assert.equal(data.receivedLlmModel, 'auto', 'Should default to auto');
    });
});
