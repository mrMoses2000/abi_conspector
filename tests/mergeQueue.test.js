import test from 'node:test';
import assert from 'node:assert/strict';
import { MergeQueue } from '../src/main/pipeline/mergeQueue.js';

test('merge queue processes jobs sequentially', async () => {
  const processed = [];

  const queue = new MergeQueue({
    worker: async (jobId) => {
      processed.push(`start:${jobId}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
      processed.push(`end:${jobId}`);
    }
  });

  queue.enqueue('job-1');
  queue.enqueue('job-2');

  await new Promise((resolve) => {
    let finished = 0;
    queue.on('job:finished', () => {
      finished += 1;
      if (finished >= 2) {
        resolve();
      }
    });
  });

  assert.deepEqual(processed, ['start:job-1', 'end:job-1', 'start:job-2', 'end:job-2']);
});
