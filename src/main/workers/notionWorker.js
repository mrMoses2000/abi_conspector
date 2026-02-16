import fs from 'node:fs/promises';
import path from 'node:path';
import { Client } from '@notionhq/client';
import { APIErrorCode, isNotionClientError } from '@notionhq/client';
import { ControlledError } from '../utils/errors.js';
import { runCodexMergeFromMarkdown } from './codexWorker.js';

const APPEND_CHUNK_SIZE = 50;
const MAX_NESTED_PAGES_SCAN = 400;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetries(action) {
  let attempt = 0;
  let delay = 700;

  while (attempt < 4) {
    attempt += 1;
    try {
      return await action();
    } catch (error) {
      const retryable =
        isNotionClientError(error) &&
        (error.code === APIErrorCode.RateLimited || error.code === APIErrorCode.ServiceUnavailable);

      if (!retryable || attempt >= 4) {
        throw error;
      }

      await sleep(delay);
      delay *= 2;
    }
  }

  throw new Error('retry exhausted');
}

/**
 * @param {Client} client
 * @param {string} pageId
 */
async function listAllChildren(client, pageId) {
  const blocks = [];
  let cursor = undefined;

  do {
    const response = await withRetries(() =>
      client.blocks.children.list({
        block_id: pageId,
        start_cursor: cursor,
        page_size: 100
      })
    );
    blocks.push(...response.results);
    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);

  return blocks;
}

function normalizeTitle(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function uniqueStrings(values) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const key = String(value || '').trim();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(key);
  }
  return out;
}

function recordingNameCandidates(recording) {
  const fileName = String(recording?.original_file_name || '').trim();
  if (!fileName) {
    return [];
  }

  const withoutExt = fileName.replace(/\.[^./\\]+$/, '');
  const softened = withoutExt.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return uniqueStrings([withoutExt, softened]);
}

/**
 * @param {Array<{id: string; title: string}>} pages
 * @param {string[]} candidates
 */
export function choosePageByTitle(pages, candidates) {
  if (!Array.isArray(pages) || pages.length === 0) {
    return null;
  }

  const targetCandidates = uniqueStrings(candidates)
    .map((title) => ({
      raw: title,
      normalized: normalizeTitle(title)
    }))
    .filter((item) => item.normalized);

  if (targetCandidates.length === 0) {
    return null;
  }

  const normalizedPages = pages
    .map((page) => ({
      ...page,
      normalized: normalizeTitle(page.title)
    }))
    .filter((page) => page.normalized);

  for (const candidate of targetCandidates) {
    const exact = normalizedPages.find((page) => page.normalized === candidate.normalized);
    if (exact) {
      return { id: exact.id, title: exact.title, matchedBy: candidate.raw, strategy: 'exact' };
    }
  }

  const containsMatches = [];
  for (const candidate of targetCandidates) {
    for (const page of normalizedPages) {
      if (page.normalized.includes(candidate.normalized) || candidate.normalized.includes(page.normalized)) {
        containsMatches.push({ page, candidate: candidate.raw });
      }
    }
  }

  const uniqueById = new Map();
  for (const match of containsMatches) {
    if (!uniqueById.has(match.page.id)) {
      uniqueById.set(match.page.id, match);
    }
  }

  if (uniqueById.size === 1) {
    const only = [...uniqueById.values()][0];
    return { id: only.page.id, title: only.page.title, matchedBy: only.candidate, strategy: 'contains' };
  }

  return null;
}

/**
 * Scans nested child pages under root page.
 * @param {Client} client
 * @param {string} rootPageId
 */
async function listNestedPages(client, rootPageId) {
  const queue = [rootPageId];
  const visited = new Set();
  const pages = [];

  while (queue.length > 0 && pages.length < MAX_NESTED_PAGES_SCAN) {
    const parentId = queue.shift();
    if (!parentId || visited.has(parentId)) {
      continue;
    }
    visited.add(parentId);

    const children = await listAllChildren(client, parentId);
    for (const block of children) {
      if (block.type !== 'child_page') {
        continue;
      }
      const pageId = block.id;
      const title = block.child_page?.title || '';
      if (!pageId || !title) {
        continue;
      }
      pages.push({ id: pageId, title });
      queue.push(pageId);
      if (pages.length >= MAX_NESTED_PAGES_SCAN) {
        break;
      }
    }
  }

  return pages;
}

/**
 * @param {Client} client
 * @param {string} pageId
 * @param {string} title
 * @param {string} rootPageId
 * @param {any} recording
 */
async function resolvePageId(client, pageId, title, rootPageId, recording) {
  const normalizedTitle = String(title || '').trim();
  const normalizedPageId = String(pageId || '').trim();
  const normalizedRootPageId = String(rootPageId || '').trim();

  const scopedRootId = normalizedRootPageId || (normalizedTitle ? normalizedPageId : '');
  if (normalizedTitle && scopedRootId) {
    const nestedPages = await listNestedPages(client, scopedRootId);
    const match = choosePageByTitle(nestedPages, [normalizedTitle]);
    if (match) {
      return match.id;
    }

    const preview = nestedPages
      .slice(0, 12)
      .map((page) => page.title)
      .join(', ');
    throw new ControlledError(
      'NOTION_PAGE_NOT_FOUND_IN_ROOT',
      `Page "${normalizedTitle}" not found under configured root page. Available: ${preview || 'none'}`
    );
  }

  if (normalizedPageId) {
    return normalizedPageId;
  }

  if (!normalizedTitle && normalizedRootPageId) {
    const nestedPages = await listNestedPages(client, normalizedRootPageId);
    const match = choosePageByTitle(nestedPages, recordingNameCandidates(recording));
    if (match) {
      return match.id;
    }
  }

  if (!normalizedTitle) {
    throw new ControlledError(
      'NOTION_TARGET_MISSING',
      'Set CONSPECTOR_NOTION_PAGE_ID or CONSPECTOR_NOTION_PAGE_TITLE. For nested pages, set CONSPECTOR_NOTION_ROOT_PAGE_ID and pass page title in UI.'
    );
  }

  const search = await withRetries(() =>
    client.search({
      query: normalizedTitle,
      filter: {
        property: 'object',
        value: 'page'
      },
      page_size: 10
    })
  );

  const exact = search.results.find((item) => {
    if (item.object !== 'page') {
      return false;
    }
    const titleProp = item.properties?.title;
    if (!titleProp || titleProp.type !== 'title') {
      return false;
    }
    const text = titleProp.title.map((node) => node.plain_text).join('').trim();
    return text === normalizedTitle;
  });

  if (!exact || exact.object !== 'page') {
    throw new ControlledError('NOTION_PAGE_NOT_FOUND', `Notion page not found by title: ${normalizedTitle}`);
  }

  return exact.id;
}

function textRich(text) {
  const normalized = text.trim();
  return [{ type: 'text', text: { content: normalized.slice(0, 1900) } }];
}

function plainTextFromRichText(richTextArray) {
  if (!Array.isArray(richTextArray) || richTextArray.length === 0) {
    return '';
  }
  return richTextArray
    .map((item) => String(item?.plain_text ?? item?.text?.content ?? ''))
    .join('')
    .trim();
}

/**
 * Converts top-level Notion blocks to markdown lines (best-effort).
 * @param {Array<any>} blocks
 */
export function notionBlocksToMarkdown(blocks) {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return '';
  }

  const lines = [];
  for (const block of blocks) {
    if (!block || typeof block !== 'object') {
      continue;
    }

    if (block.type === 'heading_1') {
      lines.push(`# ${plainTextFromRichText(block.heading_1?.rich_text || [])}`);
      lines.push('');
      continue;
    }

    if (block.type === 'heading_2') {
      lines.push(`## ${plainTextFromRichText(block.heading_2?.rich_text || [])}`);
      lines.push('');
      continue;
    }

    if (block.type === 'heading_3') {
      lines.push(`### ${plainTextFromRichText(block.heading_3?.rich_text || [])}`);
      lines.push('');
      continue;
    }

    if (block.type === 'paragraph') {
      lines.push(plainTextFromRichText(block.paragraph?.rich_text || []));
      lines.push('');
      continue;
    }

    if (block.type === 'bulleted_list_item') {
      lines.push(`- ${plainTextFromRichText(block.bulleted_list_item?.rich_text || [])}`);
      continue;
    }

    if (block.type === 'numbered_list_item') {
      lines.push(`1. ${plainTextFromRichText(block.numbered_list_item?.rich_text || [])}`);
      continue;
    }

    if (block.type === 'quote') {
      lines.push(`> ${plainTextFromRichText(block.quote?.rich_text || [])}`);
      lines.push('');
      continue;
    }

    if (block.type === 'code') {
      const lang = String(block.code?.language || '').trim();
      const code = plainTextFromRichText(block.code?.rich_text || []);
      lines.push(`\`\`\`${lang}`);
      lines.push(code);
      lines.push('```');
      lines.push('');
      continue;
    }

    if (block.type === 'divider') {
      lines.push('---');
      lines.push('');
    }
  }

  return lines.join('\n').trim();
}

/**
 * Very simple markdown -> Notion blocks mapper.
 * Supports headings, bullet/numbered lists, quote, code fences, paragraph.
 * @param {string} md
 */
export function markdownToNotionBlocks(md) {
  const lines = md.replaceAll('\r\n', '\n').split('\n');
  const blocks = [];
  let paragraphBuffer = [];
  let inCode = false;
  let codeLang = '';
  let codeBuffer = [];

  const flushParagraph = () => {
    if (paragraphBuffer.length === 0) {
      return;
    }
    const text = paragraphBuffer.join(' ').trim();
    paragraphBuffer = [];
    if (!text) {
      return;
    }
    blocks.push({
      object: 'block',
      type: 'paragraph',
      paragraph: { rich_text: textRich(text) }
    });
  };

  const flushCode = () => {
    const text = codeBuffer.join('\n').trim();
    codeBuffer = [];
    if (!text) {
      return;
    }
    blocks.push({
      object: 'block',
      type: 'code',
      code: {
        language: normalizeNotionCodeLang(codeLang),
        rich_text: textRich(text)
      }
    });
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (line.startsWith('```')) {
      if (inCode) {
        flushCode();
        inCode = false;
        codeLang = '';
      } else {
        flushParagraph();
        inCode = true;
        codeLang = line.slice(3).trim();
      }
      continue;
    }

    if (inCode) {
      codeBuffer.push(rawLine);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      continue;
    }

    const h1 = line.match(/^#\s+(.+)/);
    if (h1) {
      flushParagraph();
      blocks.push({ object: 'block', type: 'heading_1', heading_1: { rich_text: textRich(h1[1]) } });
      continue;
    }

    const h2 = line.match(/^##\s+(.+)/);
    if (h2) {
      flushParagraph();
      blocks.push({ object: 'block', type: 'heading_2', heading_2: { rich_text: textRich(h2[1]) } });
      continue;
    }

    const h3 = line.match(/^###\s+(.+)/);
    if (h3) {
      flushParagraph();
      blocks.push({ object: 'block', type: 'heading_3', heading_3: { rich_text: textRich(h3[1]) } });
      continue;
    }

    const bullet = line.match(/^-\s+(.+)/);
    if (bullet) {
      flushParagraph();
      blocks.push({
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: { rich_text: textRich(bullet[1]) }
      });
      continue;
    }

    const numbered = line.match(/^\d+\.\s+(.+)/);
    if (numbered) {
      flushParagraph();
      blocks.push({
        object: 'block',
        type: 'numbered_list_item',
        numbered_list_item: { rich_text: textRich(numbered[1]) }
      });
      continue;
    }

    const quote = line.match(/^>\s+(.+)/);
    if (quote) {
      flushParagraph();
      blocks.push({ object: 'block', type: 'quote', quote: { rich_text: textRich(quote[1]) } });
      continue;
    }

    paragraphBuffer.push(line.trim());
  }

  flushParagraph();
  if (inCode) {
    flushCode();
  }

  return blocks;
}

function normalizeNotionCodeLang(lang) {
  if (!lang) {
    return 'plain text';
  }

  const normalized = lang.toLowerCase();
  const supported = new Set([
    'abap', 'arduino', 'bash', 'basic', 'c', 'clojure', 'coffeescript', 'c++', 'c#', 'css', 'dart',
    'diff', 'docker', 'elixir', 'elm', 'erlang', 'flow', 'fortran', 'f#', 'gherkin', 'glsl', 'go',
    'graphql', 'groovy', 'haskell', 'html', 'java', 'javascript', 'json', 'julia', 'kotlin', 'latex',
    'less', 'lisp', 'livescript', 'lua', 'makefile', 'markdown', 'markup', 'matlab', 'mermaid', 'nix',
    'objective-c', 'ocaml', 'pascal', 'perl', 'php', 'plain text', 'powershell', 'prolog', 'protobuf',
    'python', 'r', 'reason', 'ruby', 'rust', 'sass', 'scala', 'scheme', 'scss', 'shell', 'sql', 'swift',
    'typescript', 'vb.net', 'verilog', 'vhdl', 'visual basic', 'webassembly', 'xml', 'yaml'
  ]);

  return supported.has(normalized) ? normalized : 'plain text';
}

/**
 * @param {{
 *   mergedPath: string;
 *   recording: any;
 *   backupsDir: string;
 *   notionConfig: {
 *     mode: 'off' | 'real';
 *     token: string;
 *     pageId: string;
 *     pageTitle: string;
 *     rootPageId?: string;
 *     mergeWithExisting?: boolean;
 *   };
 *   codexConfig?: {
 *     mode: 'real' | 'mock';
 *     fullAuto?: boolean;
 *     model: string;
 *     reasoningEffort?: string;
 *     timeoutMs: number;
 *     workdir: string;
 *     sourceNotePath: string;
 *   };
 * }} payload
 */
export async function writeMergedToNotion(payload) {
  const { mergedPath, recording, backupsDir, notionConfig, codexConfig } = payload;

  if (notionConfig.mode !== 'real') {
    return { status: 'skipped', warning: 'Notion writeback is disabled (CONSPECTOR_NOTION_MODE=off).' };
  }

  if (!notionConfig.token) {
    return { status: 'skipped', warning: 'NOTION_TOKEN is missing. Writeback skipped.' };
  }

  const client = new Client({ auth: notionConfig.token });
  const pageId = await resolvePageId(
    client,
    notionConfig.pageId,
    notionConfig.pageTitle,
    notionConfig.rootPageId || '',
    recording
  );

  const oldBlocks = await listAllChildren(client, pageId);
  const oldMarkdown = notionBlocksToMarkdown(oldBlocks);
  await fs.mkdir(backupsDir, { recursive: true });

  const backupPath = path.join(backupsDir, `${recording.id}_notion_backup.json`);
  await fs.writeFile(
    backupPath,
    JSON.stringify(
      {
        pageId,
        recordingId: recording.id,
        capturedAt: new Date().toISOString(),
        oldBlocks
      },
      null,
      2
    ),
    'utf8'
  );

  let finalMarkdown = await fs.readFile(mergedPath, 'utf8');
  let warning = '';

  if (notionConfig.mergeWithExisting && oldMarkdown.trim() && codexConfig) {
    const mergedFromNotionPath = path.join(backupsDir, `${recording.id}_merged_with_notion.md`);
    try {
      await runCodexMergeFromMarkdown({
        structuredMarkdown: finalMarkdown,
        baseMarkdown: oldMarkdown,
        outputPath: mergedFromNotionPath,
        recording,
        codexConfig
      });
      finalMarkdown = await fs.readFile(mergedFromNotionPath, 'utf8');
    } catch (error) {
      warning = `Notion merge-with-existing skipped: ${error instanceof Error ? error.message : 'unknown error'}`;
    }
  } else if (notionConfig.mergeWithExisting && oldMarkdown.trim() && !codexConfig) {
    warning = 'Notion merge-with-existing requested but codex config is missing.';
  }

  for (const block of oldBlocks) {
    await withRetries(() => client.blocks.delete({ block_id: block.id }));
  }

  const blocks = markdownToNotionBlocks(finalMarkdown);

  if (blocks.length === 0) {
    throw new ControlledError('NOTION_EMPTY_MERGE', 'Merged markdown could not be converted to Notion blocks');
  }

  for (let i = 0; i < blocks.length; i += APPEND_CHUNK_SIZE) {
    const children = blocks.slice(i, i + APPEND_CHUNK_SIZE);
    await withRetries(() => client.blocks.children.append({ block_id: pageId, children }));
  }

  return {
    status: 'written',
    pageId,
    backupPath,
    blocksWritten: blocks.length,
    warning: warning || undefined
  };
}
