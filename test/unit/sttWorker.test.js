import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildFallbackChain } from '../../src/main/workers/sttWorker.js';

describe('STT Worker Configuration', () => {

    describe('buildFallbackChain', () => {

        test('builds explicit ordered chain and filters unknown engines', () => {
            const config = {
                fallbackChain: ['groq', 'unknown', 'deepgram', 'assemblyai']
            };

            const chain = buildFallbackChain(config);
            assert.deepEqual(chain, ['groq', 'deepgram', 'assemblyai'], 'Should filter unknown engines');
        });

        test('builds legacy primary+fallback chain', () => {
            const config = {
                primary: 'assemblyai',
                fallback: 'whispercpp'
            };

            const chain = buildFallbackChain(config);
            assert.deepEqual(chain, ['assemblyai', 'whispercpp']);
        });

        test('deduplicates legacy primary+fallback if they are the same', () => {
            const config = {
                primary: 'groq',
                fallback: 'groq'
            };

            const chain = buildFallbackChain(config);
            assert.deepEqual(chain, ['groq']);
        });

        test('ignores fallback if fallback is "none"', () => {
            const config = {
                primary: 'groq',
                fallback: 'none'
            };

            const chain = buildFallbackChain(config);
            assert.deepEqual(chain, ['groq']);
        });

        test('defaults to groq if everything is invalid', () => {
            const config = {
                primary: 'alien_tech',
                fallback: 'magic'
            };

            const chain = buildFallbackChain(config);
            assert.deepEqual(chain, ['groq']);
        });

        test('explicit fallbackChain array takes precedence over legacy primary/fallback', () => {
            const config = {
                primary: 'assemblyai',
                fallback: 'whispercpp',
                fallbackChain: ['deepgram']
            };

            const chain = buildFallbackChain(config);
            assert.deepEqual(chain, ['deepgram']);
        });

    });

});
