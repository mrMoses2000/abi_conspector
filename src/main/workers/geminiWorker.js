import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { ControlledError } from '../utils/errors.js';
import { runCommand } from '../utils/process.js';

async function readText(pathname) {
    return fs.readFile(pathname, 'utf8');
}

function geminiFailureHint(message) {
    const text = String(message || '');
    const match = text.match(/gemini exited with code (\d+)/i);
    const code = match ? Number.parseInt(match[1], 10) : NaN;
    if (code === 41) {
        return 'Gemini auth failed (code 41): configure GEMINI_API_KEY for the service user or run Gemini login for that user.';
    }
    if (code === 42) {
        return 'Gemini usage/config failed (code 42): check model name, flags, and CLI version.';
    }
    if (code === 52) {
        return 'Gemini config file error (code 52): verify ~/.gemini settings for the service user.';
    }
    return '';
}

/**
 * @param {{
 *   model?: string;
 *   workdir: string;
 *   sandbox?: boolean;
 * }} config
 */
export function buildGeminiArgs(config) {
    const args = ['--prompt', '-'];

    if (config.model) {
        args.push('--model', config.model);
    }

    args.push('--output-format', 'text');

    if (config.sandbox === false) {
        args.push('--sandbox=false');
    }

    return args;
}

/**
 * @param {{
 *   mode: 'real' | 'mock';
 *   model: string;
 *   sandbox?: boolean;
 *   timeoutMs: number;
 *   workdir: string;
 *   sourceNotePath: string;
 * }} config
 * @param {string} outputPath
 * @param {string} prompt
 */
async function runGemini(config, outputPath, prompt) {
    if (config.mode === 'mock') {
        const mockMarkdown = [
            '# Mock Gemini Output',
            '',
            '> Generated in CONSPECTOR_GEMINI_MODE=mock.',
            '',
            '## Notes',
            '- Real gemini worker is disabled.',
            '',
            '## Prompt Snapshot',
            '```text',
            prompt.slice(0, 1400),
            '```'
        ].join('\n');
        await fs.writeFile(outputPath, mockMarkdown, 'utf8');
        await fs.writeFile(`${outputPath}.gemini.log`, '[mock] gemini worker disabled\n', 'utf8');
        return;
    }

    const args = buildGeminiArgs(config);
    const logPath = `${outputPath}.gemini.log`;
    const logStream = createWriteStream(logPath, { flags: 'a', encoding: 'utf8' });
    const writeLog = (streamName, chunk) => {
        logStream.write(`[${new Date().toISOString()}][${streamName}] ${chunk}`);
    };
    writeLog('meta', `start model=${config.model || '(default)'}\n`);

    let result;
    try {
        result = await runCommand({
            command: 'gemini',
            args,
            cwd: config.workdir,
            stdin: prompt,
            timeoutMs: config.timeoutMs,
            onStdout: (chunk) => writeLog('stdout', chunk),
            onStderr: (chunk) => writeLog('stderr', chunk)
        });
    } catch (error) {
        writeLog('meta', `failed ${error instanceof Error ? error.message : 'unknown error'}\n`);
        if (error instanceof ControlledError) {
            const hint = geminiFailureHint(error.message);
            const suffix = hint ? ` Подсказка: ${hint}` : '';
            throw new ControlledError('GEMINI_EXEC_FAILED', `${error.message}.${suffix} Лог: ${logPath}`);
        }
        throw error;
    } finally {
        await new Promise((resolve) => {
            logStream.end(resolve);
        });
    }

    // Gemini CLI prints output to stdout in --prompt mode
    const output = result?.stdout?.trim() || '';
    if (!output) {
        throw new ControlledError('GEMINI_EMPTY_OUTPUT', 'gemini --prompt returned empty output');
    }

    await fs.writeFile(outputPath, output, 'utf8');
}

function getGeminiSkillPath(workdir, skillName) {
    return path.join(workdir, '.agents', 'skills', 'gemini', `${skillName}.txt`);
}

/**
 * @param {{
 *   structuredMarkdown: string;
 *   baseMarkdown: string;
 *   outputPath: string;
 *   recording: any;
 *   geminiConfig: {
 *     mode: 'real' | 'mock';
 *     model: string;
 *     sandbox?: boolean;
 *     timeoutMs: number;
 *     workdir: string;
 *     sourceNotePath: string;
 *   };
 * }} payload
 */
export async function runGeminiMergeFromMarkdown(payload) {
    const { structuredMarkdown, baseMarkdown, outputPath, recording, geminiConfig } = payload;
    const skillPath = getGeminiSkillPath(geminiConfig.workdir, 'conspector-merge');
    const skillContent = await readText(skillPath).catch(() => '');

    const prompt = `<system_instructions>\n${skillContent}\n</system_instructions>\n\n<context>\nStructured markdown:\n\n\`\`\`md\n${structuredMarkdown}\n\`\`\`\n\nBase note markdown:\n\n\`\`\`md\n${baseMarkdown || '# (пусто)'}\n\`\`\`\n</context>\n\n<task>\nВыполни задачу по интеграции базы знаний согласно системным инструкциям.\n</task>`;

    await runGemini(geminiConfig, outputPath, prompt);
}

/**
 * @param {{
 *   transcriptPath: string;
 *   structuredPath: string;
 *   recording: any;
 *   geminiConfig: {
 *     mode: 'real' | 'mock';
 *     model: string;
 *     sandbox?: boolean;
 *     timeoutMs: number;
 *     workdir: string;
 *     sourceNotePath: string;
 *   };
 * }} payload
 */
export async function runGeminiStructure(payload) {
    const { transcriptPath, structuredPath, recording, geminiConfig } = payload;
    const transcriptJson = await readText(transcriptPath);

    const skillPath = getGeminiSkillPath(geminiConfig.workdir, 'conspector-structure');
    const skillContent = await readText(skillPath).catch(() => '');

    const prompt = `<system_instructions>\n${skillContent}\n</system_instructions>\n\n<context>\nTranscript JSON:\n\n\`\`\`json\n${transcriptJson}\n\`\`\`\n</context>\n\n<task>\nПреобразуй транскрипт в конспект согласно системным инструкциям.\n</task>`;

    await runGemini(geminiConfig, structuredPath, prompt);
}

/**
 * @param {{
 *   structuredPath: string;
 *   mergedPath: string;
 *   recording: any;
 *   geminiConfig: {
 *     mode: 'real' | 'mock';
 *     model: string;
 *     sandbox?: boolean;
 *     timeoutMs: number;
 *     workdir: string;
 *     sourceNotePath: string;
 *   };
 * }} payload
 */
export async function runGeminiMerge(payload) {
    const { structuredPath, mergedPath, recording, geminiConfig } = payload;
    const structuredMd = await readText(structuredPath);

    let sourceMd = '';
    if (geminiConfig.sourceNotePath) {
        const sourcePath = path.resolve(geminiConfig.sourceNotePath);
        sourceMd = await fs.readFile(sourcePath, 'utf8').catch(() => '');
    }

    await runGeminiMergeFromMarkdown({
        structuredMarkdown: structuredMd,
        baseMarkdown: sourceMd,
        outputPath: mergedPath,
        recording,
        geminiConfig
    });
}
