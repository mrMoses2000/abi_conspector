import test from 'node:test';
import assert from 'node:assert/strict';
import {
  choosePageByTitle,
  markdownToNotionBlocks,
  notionBlocksToMarkdown
} from '../src/main/workers/notionWorker.js';

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

test('choosePageByTitle resolves exact normalized title', () => {
  const pages = [
    { id: 'p1', title: '🖊 Русский язык и культура речи' },
    { id: 'p2', title: 'Гомилетика' }
  ];

  const match = choosePageByTitle(pages, ['Русский язык и культура речи']);
  assert.ok(match);
  assert.equal(match.id, 'p1');
  assert.equal(match.strategy, 'exact');
});

test('choosePageByTitle resolves unique contains match', () => {
  const pages = [
    { id: 'p1', title: 'Русский язык и культура речи' },
    { id: 'p2', title: 'Гомилетика' }
  ];

  const match = choosePageByTitle(pages, ['культура']);
  assert.ok(match);
  assert.equal(match.id, 'p1');
  assert.equal(match.strategy, 'contains');
});

test('notionBlocksToMarkdown converts common blocks back to markdown', () => {
  const md = notionBlocksToMarkdown([
    {
      type: 'heading_1',
      heading_1: { rich_text: [{ plain_text: 'Заголовок' }] }
    },
    {
      type: 'paragraph',
      paragraph: { rich_text: [{ plain_text: 'Текст параграфа' }] }
    },
    {
      type: 'bulleted_list_item',
      bulleted_list_item: { rich_text: [{ plain_text: 'Пункт' }] }
    },
    {
      type: 'code',
      code: { language: 'mermaid', rich_text: [{ plain_text: 'graph TD\nA-->B' }] }
    }
  ]);

  assert.match(md, /^# Заголовок/m);
  assert.match(md, /Текст параграфа/);
  assert.match(md, /^- Пункт/m);
  assert.match(md, /```mermaid/);
});
