import fs from 'node:fs/promises';
import path from 'node:path';
import { Client } from '@notionhq/client';
import { APIErrorCode, isNotionClientError } from '@notionhq/client';
import { ControlledError } from '../utils/errors.js';

const APPEND_CHUNK_SIZE = 50;

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

/**
 * @param {Client} client
 * @param {string} pageId
 * @param {string} title
 */
async function resolvePageId(client, pageId, title) {
  if (pageId) {
    return pageId;
  }

  if (!title) {
    throw new ControlledError('NOTION_TARGET_MISSING', 'Set CONSPECTOR_NOTION_PAGE_ID or CONSPECTOR_NOTION_PAGE_TITLE');
  }

  const search = await withRetries(() =>
    client.search({
      query: title,
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
    return text === title;
  });

  if (!exact || exact.object !== 'page') {
    throw new ControlledError('NOTION_PAGE_NOT_FOUND', `Notion page not found by title: ${title}`);
  }

  return exact.id;
}

function textRich(text) {
  const normalized = text.trim();
  return [{ type: 'text', text: { content: normalized.slice(0, 1900) } }];
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
 *   };
 * }} payload
 */
export async function writeMergedToNotion(payload) {
  const { mergedPath, recording, backupsDir, notionConfig } = payload;

  if (notionConfig.mode !== 'real') {
    return { status: 'skipped', warning: 'Notion writeback is disabled (CONSPECTOR_NOTION_MODE=off).' };
  }

  if (!notionConfig.token) {
    return { status: 'skipped', warning: 'NOTION_TOKEN is missing. Writeback skipped.' };
  }

  const client = new Client({ auth: notionConfig.token });
  const pageId = await resolvePageId(client, notionConfig.pageId, notionConfig.pageTitle);

  const oldBlocks = await listAllChildren(client, pageId);
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

  for (const block of oldBlocks) {
    await withRetries(() => client.blocks.delete({ block_id: block.id }));
  }

  const mergedMd = await fs.readFile(mergedPath, 'utf8');
  const blocks = markdownToNotionBlocks(mergedMd);

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
    blocksWritten: blocks.length
  };
}
