import { runCodexStructure, runCodexMerge, runCodexMergeFromMarkdown } from './codexWorker.js';
import { runGeminiStructure, runGeminiMerge, runGeminiMergeFromMarkdown } from './geminiWorker.js';

/**
 * Returns the correct LLM config key name based on provider.
 * @param {'codex' | 'gemini'} provider
 */
export function getLlmConfigKey(provider) {
    return provider === 'gemini' ? 'gemini' : 'codex';
}

/**
 * Returns the structure worker function for the given provider.
 * @param {'codex' | 'gemini'} provider
 */
export function getStructureWorker(provider) {
    if (provider === 'gemini') {
        return (payload) => runGeminiStructure({
            transcriptPath: payload.transcriptPath,
            structuredPath: payload.structuredPath,
            recording: payload.recording,
            geminiConfig: payload.llmConfig
        });
    }
    return (payload) => runCodexStructure({
        transcriptPath: payload.transcriptPath,
        structuredPath: payload.structuredPath,
        recording: payload.recording,
        codexConfig: payload.llmConfig
    });
}

/**
 * Returns the merge worker function for the given provider.
 * @param {'codex' | 'gemini'} provider
 */
export function getMergeWorker(provider) {
    if (provider === 'gemini') {
        return (payload) => runGeminiMerge({
            structuredPath: payload.structuredPath,
            mergedPath: payload.mergedPath,
            recording: payload.recording,
            geminiConfig: payload.llmConfig
        });
    }
    return (payload) => runCodexMerge({
        structuredPath: payload.structuredPath,
        mergedPath: payload.mergedPath,
        recording: payload.recording,
        codexConfig: payload.llmConfig
    });
}

/**
 * Returns the merge-from-markdown worker function for the given provider.
 * @param {'codex' | 'gemini'} provider
 */
export function getMergeFromMarkdownWorker(provider) {
    if (provider === 'gemini') {
        return (payload) => runGeminiMergeFromMarkdown({
            structuredMarkdown: payload.structuredMarkdown,
            baseMarkdown: payload.baseMarkdown,
            outputPath: payload.outputPath,
            recording: payload.recording,
            geminiConfig: payload.llmConfig
        });
    }
    return (payload) => runCodexMergeFromMarkdown({
        structuredMarkdown: payload.structuredMarkdown,
        baseMarkdown: payload.baseMarkdown,
        outputPath: payload.outputPath,
        recording: payload.recording,
        codexConfig: payload.llmConfig
    });
}
