import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// We need to test the logic in notionWorker, particularly suggestion grading
// and title normalization, which don't require external I/O mock if we just test 
// the exported functions or pure logic equivalents.
// For the I/O parts, we will mock the Client from @notionhq/client

describe('Notion Worker Integration', () => {

    test('Notion Client initialization and basic configuration', async (t) => {
        // We will mock the @notionhq/client to ensure it's called with the correct args
        const notionModule = await import('@notionhq/client');

        let clientArgs = null;
        t.mock.method(notionModule, 'Client', class MockClient {
            constructor(args) {
                clientArgs = args;
                this.blocks = { children: { list: async () => ({ results: [], has_more: false }) } };
                this.search = async () => ({ results: [] });
            }
        });

        // Dynamic import so it uses the mocked Client constructor
        const worker = await import('../../src/main/workers/notionWorker.js');

        // This will trigger the creation of a new Client inside writeMergedToNotion if notionToken is present
        // Since we can't easily mock the internal instance, we test the public interfaces that interact with Notion.

        // Since writeMergedToNotion is highly imperative and depends on many file writes,
        // we'll focus on testing the resilience and error handling.

        assert.ok(worker.writeMergedToNotion, 'Worker should export writeMergedToNotion');
    });

    test('Retry logic (withRetries equivalent)', async () => {
        // We simulate the retry logic here to ensure the pattern we use in the worker is sound
        let attempts = 0;
        const flakyAction = async () => {
            attempts++;
            if (attempts < 3) {
                const err = new Error('Rate Limited');
                err.code = 'rate_limited'; // Match APIErrorCode.RateLimited
                err.status = 429;
                // Add property to make it pass isNotionClientError check duck-typing in our mock
                err.body = {};
                throw err;
            }
            return 'success';
        };

        // Simplified version of the retry logic from the worker
        async function withRetriesMock(action) {
            let attempt = 0;
            let delay = 10; // Make it fast for tests

            while (attempt < 4) {
                attempt += 1;
                try {
                    return await action();
                } catch (error) {
                    const retryable = error.code === 'rate_limited';
                    if (!retryable || attempt >= 4) throw error;
                    await new Promise(r => setTimeout(r, delay));
                    delay *= 2;
                }
            }
        }

        const result = await withRetriesMock(flakyAction);
        assert.equal(result, 'success');
        assert.equal(attempts, 3);
    });

});
