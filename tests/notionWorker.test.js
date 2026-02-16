import test from 'node:test';
import assert from 'node:assert/strict';
import { markdownToNotionBlocks } from '../src/main/workers/notionWorker.js';

test('markdownToNotionBlocks converts common markdown structures', () => {
  const md = [
    '# Title',
    '',
    '## Section',
    '',
    '- one',
    '1. two',
    '> quoted',
    '',
    'paragraph line 1',
    'paragraph line 2',
    '',
    '```mermaid',
    'graph TD',
    'A-->B',
    '```'
  ].join('\n');

  const blocks = markdownToNotionBlocks(md);
  assert.ok(blocks.length >= 6);

  const types = blocks.map((b) => b.type);
  assert.ok(types.includes('heading_1'));
  assert.ok(types.includes('heading_2'));
  assert.ok(types.includes('bulleted_list_item'));
  assert.ok(types.includes('numbered_list_item'));
  assert.ok(types.includes('quote'));
  assert.ok(types.includes('paragraph'));
  assert.ok(types.includes('code'));
});
