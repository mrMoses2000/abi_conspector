import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { executeWithLlmFallback, executeSttFallback } from '../../src/main/utils/fallback.js';

describe('Fallback Utility', () => {

    describe('executeWithLlmFallback', () => {
        test('returns immediately on first success', async () => {
            let callCount = 0;
            const chain = [{ provider: 'p1', label: '1', configKey: 'p1cfg', configOverrides: {} }, { provider: 'p2', label: '2', configKey: 'p2cfg', configOverrides: {} }];

            const runner = async (provider) => {
                callCount++;
                if (provider === 'p2') throw new Error('should not be called');
            };

            const appendWarning = () => { };
            await executeWithLlmFallback(chain, {}, appendWarning, 'test', runner);

            assert.equal(callCount, 1, 'Runner should be called exactly once');
        });

        test('falls back to next provider on error', async () => {
            let calledProviders = [];
            const chain = [
                { provider: 'fail1', label: '1', configKey: 'c1', configOverrides: {} },
                { provider: 'success2', label: '2', configKey: 'c2', configOverrides: {} },
                { provider: 'not_called3', label: '3', configKey: 'c3', configOverrides: {} }
            ];

            const runner = async (provider) => {
                calledProviders.push(provider);
                if (provider === 'fail1') throw new Error('Simulated failure');
            };

            let warnings = [];
            const appendWarning = (msg) => warnings.push(msg);

            await executeWithLlmFallback(chain, {}, appendWarning, 'test_stage', runner);

            assert.deepEqual(calledProviders, ['fail1', 'success2']);
            assert.equal(warnings.length, 1);
            assert.match(warnings[0], /test_stage: 1 failed → used 2/);
        });

        test('throws if all providers fail and no mock fallback allowed', async () => {
            const chain = [{ provider: 'p1', label: '1', configKey: 'c1', configOverrides: {} }];
            const runner = async () => { throw new Error('Final failure'); };

            await assert.rejects(
                executeWithLlmFallback(chain, { resilience: { codexFallbackToMock: false } }, () => { }, 'stage', runner),
                /Final failure/
            );
        });

        test('falls back to mock if all fail and mock allowed', async () => {
            const chain = [{ provider: 'p1', label: '1', configKey: 'c1', configOverrides: {} }];
            let mockCalled = false;
            const runner = async (provider, config) => {
                if (config.mode === 'mock') {
                    mockCalled = true;
                    return;
                }
                throw new Error('Real mode failure');
            };

            const runtimeConfig = {
                c1: { mode: 'real' },
                resilience: { codexFallbackToMock: true }
            };

            let warnings = [];
            await executeWithLlmFallback(chain, runtimeConfig, msg => warnings.push(msg), 'stage', runner);

            assert.equal(mockCalled, true);
            assert.match(warnings[0], /fallback to mock/i);
        });
    });

    describe('executeSttFallback', () => {
        test('succeeds on first engine', async () => {
            let calls = 0;
            await executeSttFallback(['e1', 'e2'], async (engine) => {
                calls++;
                if (engine === 'e2') throw new Error('fail');
            }, () => { });
            assert.equal(calls, 1);
        });

        test('calls onFallback handler before next attempt', async () => {
            let callbacks = [];
            const runner = async (engine) => {
                if (engine === 'fail_engine') throw new Error('bad');
            };
            const onFallback = async (engine) => {
                callbacks.push(engine);
            };

            await executeSttFallback(['fail_engine', 'good_engine'], runner, onFallback);
            assert.deepEqual(callbacks, ['fail_engine']);
        });

        test('throws comprehensive error if all STT engines fail', async () => {
            await assert.rejects(
                executeSttFallback(['e1', 'e2'], async () => { throw new Error('crash'); }, () => { }),
                /STT failed across all engines.*e1: crash; e2: crash/
            );
        });
    });

});
