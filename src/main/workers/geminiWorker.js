import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { ControlledError } from '../utils/errors.js';
import { runCommand } from '../utils/process.js';

async function readText(pathname) {
    return fs.readFile(pathname, 'utf8');
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
            throw new ControlledError('GEMINI_EXEC_FAILED', `${error.message}. Лог: ${logPath}`);
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
    const prompt = `Ты редактор учебного материала.\n\nЗадача: сделать полную merged-версию конспекта в markdown на русском языке.\n\nТребования:\n- Верни только markdown.\n- Если базовый конспект пустой, используй структурированный материал как основу.\n- Если базовый конспект есть, аккуратно объединяй и улучшай структуру.\n- Сохрани совместимость с импортом в Notion (обычные заголовки/списки/таблицы/цитаты).\n- Добавь раздел \"Схема\" с mermaid-блоком.\n\nКонтекст:\n- recording_id: ${recording.id}\n- source_file: ${recording.original_file_name ?? recording.id}\n\nStructured markdown:\n\n\`\`\`md\n${structuredMarkdown}\n\`\`\`\n\nBase note markdown:\n\n\`\`\`md\n${baseMarkdown || '# (пусто)'}\n\`\`\``;

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

    const prompt = `Ты редактор академического конспекта.\n\nЗадача: преобразуй diarized transcript в качественный русский markdown-конспект.\n\nПравила:\n- Пиши строго markdown и без пояснений вне результата.\n- Сохраняй факты из транскрипта, не выдумывай новые.\n- Используй структуру: \"Краткое summary\", \"Ключевые тезисы\", \"Термины\", \"Примеры\", \"Вопросы к экзамену\", \"TODO\".\n- Если в транскрипте есть неоднозначности, добавь блок \"Открытые вопросы\".\n\nКонтекст:\n- recording_id: ${recording.id}\n- source_file: ${recording.original_file_name ?? recording.id}\n\nTranscript JSON:\n\n\`\`\`json\n${transcriptJson}\n\`\`\``;

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
