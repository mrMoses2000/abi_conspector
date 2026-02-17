import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGeminiArgs } from '../src/main/workers/geminiWorker.js';

test('buildGeminiArgs produces correct args with model and sandbox off', () => {
    const args = buildGeminiArgs({
        model: 'gemini-3-flash-preview',
        workdir: '/tmp/work',
        sandbox: false
    });

    assert.deepEqual(args, [
        '--prompt', '-',
        '--model', 'gemini-3-flash-preview',
        '--output-format', 'text',
        '--sandbox=false'
    ]);
});

test('buildGeminiArgs omits model when empty', () => {
    const args = buildGeminiArgs({
        model: '',
        workdir: '/tmp/work',
        sandbox: false
    });

    assert.deepEqual(args, [
        '--prompt', '-',
        '--output-format', 'text',
        '--sandbox=false'
    ]);
});

test('buildGeminiArgs omits sandbox flag when not explicitly false', () => {
    const args = buildGeminiArgs({
        model: 'gemini-3-flash-preview',
        workdir: '/tmp/work'
    });

    assert.deepEqual(args, [
        '--prompt', '-',
        '--model', 'gemini-3-flash-preview',
        '--output-format', 'text'
    ]);
});

test('buildGeminiArgs with sandbox true does not add --sandbox=false', () => {
    const args = buildGeminiArgs({
        model: 'gemini-3-flash-preview',
        workdir: '/tmp/work',
        sandbox: true
    });

    assert.deepEqual(args, [
        '--prompt', '-',
        '--model', 'gemini-3-flash-preview',
        '--output-format', 'text'
    ]);
});
