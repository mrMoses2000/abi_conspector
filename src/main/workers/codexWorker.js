import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { ControlledError } from '../utils/errors.js';
import { runCommand } from '../utils/process.js';

async function readText(pathname) {
  return fs.readFile(pathname, 'utf8');
}

/**
 * @param {string | undefined} value
 */
export function normalizeReasoningEffort(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'low' || normalized === 'medium' || normalized === 'high') {
    return normalized;
  }
  return 'medium';
}

/**
 * @param {{
 *   fullAuto?: boolean;
 *   model?: string;
 *   workdir: string;
 *   reasoningEffort?: string;
 * }} config
 * @param {string} outputPath
 */
export function buildCodexExecArgs(config, outputPath) {
  const args = ['exec', '--skip-git-repo-check', '--output-last-message', outputPath, '--cd', config.workdir];
  if (config.fullAuto !== false) {
    args.push('--full-auto');
  }

  if (config.model) {
    args.push('-m', config.model);
  }

  args.push('-c', `model_reasoning_effort="${normalizeReasoningEffort(config.reasoningEffort)}"`);
  args.push('-');
  return args;
}

/**
 * @param {{
 *   mode: 'real' | 'mock';
 *   fullAuto?: boolean;
 *   model: string;
 *   reasoningEffort?: string;
 *   timeoutMs: number;
 *   workdir: string;
 *   sourceNotePath: string;
 * }} config
 * @param {string} outputPath
 * @param {string} prompt
 */
async function runCodex(config, outputPath, prompt) {
  if (config.mode === 'mock') {
    const mockMarkdown = [
      '# Mock Codex Output',
      '',
      '> Generated in CONSPECTOR_CODEX_MODE=mock.',
      '',
      '## Notes',
      '- Real codex worker is disabled.',
      '',
      '## Prompt Snapshot',
      '```text',
      prompt.slice(0, 1400),
      '```'
    ].join('\n');
    await fs.writeFile(outputPath, mockMarkdown, 'utf8');
    await fs.writeFile(`${outputPath}.codex.log`, '[mock] codex worker disabled\n', 'utf8');
    return;
  }

  const args = buildCodexExecArgs(config, outputPath);
  const logPath = `${outputPath}.codex.log`;
  const logStream = createWriteStream(logPath, { flags: 'a', encoding: 'utf8' });
  const writeLog = (streamName, chunk) => {
    logStream.write(`[${new Date().toISOString()}][${streamName}] ${chunk}`);
  };
  writeLog('meta', `start model=${config.model || '(default)'} effort=${normalizeReasoningEffort(config.reasoningEffort)}\n`);

  try {
    await runCommand({
      command: 'codex',
      args,
      stdin: prompt,
      timeoutMs: config.timeoutMs,
      onStdout: (chunk) => writeLog('stdout', chunk),
      onStderr: (chunk) => writeLog('stderr', chunk)
    });
  } catch (error) {
    writeLog('meta', `failed ${error instanceof Error ? error.message : 'unknown error'}\n`);
    if (error instanceof ControlledError) {
      throw new ControlledError('CODEX_EXEC_FAILED', `${error.message}. Лог: ${logPath}`);
    }
    throw error;
  } finally {
    await new Promise((resolve) => {
      logStream.end(resolve);
    });
  }

  const text = await fs.readFile(outputPath, 'utf8').catch(() => '');
  if (!text.trim()) {
    throw new ControlledError('CODEX_EMPTY_OUTPUT', 'codex exec returned empty output');
  }
}

function getCodexSkillPath(workdir, skillName) {
  return path.join(workdir, '.agents', 'skills', 'codex', skillName, 'SKILL.md');
}

/**
 * @param {{
 *   structuredMarkdown: string;
 *   baseMarkdown: string;
 *   outputPath: string;
 *   recording: any;
 *   codexConfig: {
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
export async function runCodexMergeFromMarkdown(payload) {
  const { structuredMarkdown, baseMarkdown, outputPath, recording, codexConfig } = payload;
  const skillPath = getCodexSkillPath(codexConfig.workdir, 'conspector-merge');
  const prompt = `$conspector-merge\nPath: ${skillPath}\n\nStructured markdown:\n\n\`\`\`md\n${structuredMarkdown}\n\`\`\`\n\nBase note markdown:\n\n\`\`\`md\n${baseMarkdown || '# (пусто)'}\n\`\`\``;

  await runCodex(codexConfig, outputPath, prompt);
}

/**
 * @param {{
 *   transcriptPath: string;
 *   structuredPath: string;
 *   recording: any;
 *   codexConfig: {
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
export async function runCodexStructure(payload) {
  const { transcriptPath, structuredPath, recording, codexConfig } = payload;
  const transcriptJson = await readText(transcriptPath);

  const skillPath = getCodexSkillPath(codexConfig.workdir, 'conspector-structure');
  const prompt = `$conspector-structure\nPath: ${skillPath}\n\nTranscript JSON:\n\n\`\`\`json\n${transcriptJson}\n\`\`\``;

  await runCodex(codexConfig, structuredPath, prompt);
}

/**
 * @param {{
 *   structuredPath: string;
 *   mergedPath: string;
 *   recording: any;
 *   codexConfig: {
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
export async function runCodexMerge(payload) {
  const { structuredPath, mergedPath, recording, codexConfig } = payload;
  const structuredMd = await readText(structuredPath);

  let sourceMd = '';
  if (codexConfig.sourceNotePath) {
    const sourcePath = path.resolve(codexConfig.sourceNotePath);
    sourceMd = await fs.readFile(sourcePath, 'utf8').catch(() => '');
  }

  await runCodexMergeFromMarkdown({
    structuredMarkdown: structuredMd,
    baseMarkdown: sourceMd,
    outputPath: mergedPath,
    recording,
    codexConfig
  });
}
