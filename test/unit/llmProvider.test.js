import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { buildLlmFallbackChain, getLlmConfigKey } from '../../src/main/workers/llmProvider.js';

describe('LLM Provider Configuration', () => {
    let mockRuntimeConfig;

    before(() => {
        // Mock a basic runtime config matching the structure expected
        mockRuntimeConfig = {
            llm: { provider: 'gemini' },
            gemini: { mode: 'real', model: 'gemini-1.5-flash', timeoutMs: 60000 },
            codex: { mode: 'real', timeoutMs: 300000, reasoningEffort: 'low' }
        };
    });

    describe('getLlmConfigKey', () => {
        test('returns correct key', () => {
            assert.equal(getLlmConfigKey('gemini'), 'gemini');
            assert.equal(getLlmConfigKey('codex'), 'codex');
            assert.equal(getLlmConfigKey('unknown'), 'codex'); // Defaults back to codex per logic
        });
    });

    describe('buildLlmFallbackChain', () => {

        test('returns single entry for specific model selection (no fallback)', () => {
            const chain = buildLlmFallbackChain('codex-high', mockRuntimeConfig);
            assert.equal(chain.length, 1);

            const entry = chain[0];
            assert.equal(entry.provider, 'codex');
            assert.equal(entry.configKey, 'codex');
            assert.equal(entry.configOverrides.reasoningEffort, 'high');
            assert.equal(entry.label, 'Codex CLI (high)');
        });

        test('returns default auto chain when selection is auto', () => {
            // Unset environment variable so default chain is used
            const originalEnv = process.env.CONSPECTOR_LLM_FALLBACK_CHAIN;
            delete process.env.CONSPECTOR_LLM_FALLBACK_CHAIN;

            const chain = buildLlmFallbackChain('auto', mockRuntimeConfig);

            // Default built-in is usually gemini-2.5-pro, gemini-2.5-flash, codex-medium
            assert.equal(chain.length, 3);
            assert.equal(chain[0].provider, 'gemini');
            assert.equal(chain[0].configOverrides.model, 'gemini-2.5-pro');

            assert.equal(chain[1].provider, 'gemini');
            assert.equal(chain[1].configOverrides.model, 'gemini-2.5-flash');

            assert.equal(chain[2].provider, 'codex');
            assert.equal(chain[2].configOverrides.reasoningEffort, 'medium');

            // Restore
            if (originalEnv) process.env.CONSPECTOR_LLM_FALLBACK_CHAIN = originalEnv;
        });

        test('builds auto chain using CONSPECTOR_LLM_FALLBACK_CHAIN env if present', () => {
            const originalEnv = process.env.CONSPECTOR_LLM_FALLBACK_CHAIN;
            process.env.CONSPECTOR_LLM_FALLBACK_CHAIN = 'codex-low,gemini-3-pro-preview';

            const chain = buildLlmFallbackChain('auto', mockRuntimeConfig);
            assert.equal(chain.length, 2);
            assert.equal(chain[0].provider, 'codex');
            assert.equal(chain[0].configOverrides.reasoningEffort, 'low');
            assert.equal(chain[1].provider, 'gemini');
            assert.equal(chain[1].configOverrides.model, 'gemini-3-pro-preview');

            // Restore
            process.env.CONSPECTOR_LLM_FALLBACK_CHAIN = originalEnv;
        });

        test('handles invalid auto chain config via fallback to runtime default', () => {
            const originalEnv = process.env.CONSPECTOR_LLM_FALLBACK_CHAIN;
            process.env.CONSPECTOR_LLM_FALLBACK_CHAIN = 'totally-unknown-model'; // Unmatched in catalog

            const chain = buildLlmFallbackChain('auto', mockRuntimeConfig);

            // Should fallback to default runtime config since no valid catalog matches
            assert.equal(chain.length, 1);
            assert.equal(chain[0].provider, 'gemini');
            assert.deepEqual(chain[0].configOverrides, {});

            process.env.CONSPECTOR_LLM_FALLBACK_CHAIN = originalEnv;
        });

    });

});
