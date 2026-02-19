import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeMermaidFences } from '../src/main/workers/htmlWorker.js';

test('sanitizeMermaidFences quotes node labels with punctuation and cyrillic text', () => {
  const input = [
    '# Схема',
    '',
    '```mermaid',
    'graph TD',
    'E3[Среда (внешний контекст)]',
    'D{Критический анализ}',
    'D -- по критериям --> E3;',
    '```'
  ].join('\n');

  const output = sanitizeMermaidFences(input);
  assert.match(output, /E3\["Среда \(внешний контекст\)"\]/);
  assert.match(output, /D\{"Критический анализ"\}/);
});

test('sanitizeMermaidFences keeps already-quoted labels and normalizes inner quotes', () => {
  const input = [
    '```mermaid',
    'graph TD',
    'A["Узел \\"1\\""]',
    'B[Пример "кавычек"]',
    '```'
  ].join('\n');

  const output = sanitizeMermaidFences(input);
  assert.match(output, /A\["Узел '1'"\]/);
  assert.match(output, /B\["Пример 'кавычек'"\]/);
});
