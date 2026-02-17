import test from 'node:test';
import assert from 'node:assert/strict';
import { getLlmConfigKey, getStructureWorker, getMergeWorker, getMergeFromMarkdownWorker } from '../src/main/workers/llmProvider.js';

test('getLlmConfigKey returns codex by default', () => {
    assert.equal(getLlmConfigKey('codex'), 'codex');
});

test('getLlmConfigKey returns gemini for gemini provider', () => {
    assert.equal(getLlmConfigKey('gemini'), 'gemini');
});

test('getStructureWorker returns a function for codex', () => {
    const worker = getStructureWorker('codex');
    assert.equal(typeof worker, 'function');
});

test('getStructureWorker returns a function for gemini', () => {
    const worker = getStructureWorker('gemini');
    assert.equal(typeof worker, 'function');
});

test('getMergeWorker returns a function for codex', () => {
    const worker = getMergeWorker('codex');
    assert.equal(typeof worker, 'function');
});

test('getMergeWorker returns a function for gemini', () => {
    const worker = getMergeWorker('gemini');
    assert.equal(typeof worker, 'function');
});

test('getMergeFromMarkdownWorker returns a function for codex', () => {
    const worker = getMergeFromMarkdownWorker('codex');
    assert.equal(typeof worker, 'function');
});

test('getMergeFromMarkdownWorker returns a function for gemini', () => {
    const worker = getMergeFromMarkdownWorker('gemini');
    assert.equal(typeof worker, 'function');
});
