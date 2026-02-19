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

/**
 * Known LLM model entries. Each entry defines provider, model name, and config overrides.
 */
const LLM_MODEL_CATALOG = {
    'gemini-2.5-pro': { provider: 'gemini', model: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    'gemini-2.5-flash': { provider: 'gemini', model: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    'gemini-3-pro-preview': { provider: 'gemini', model: 'gemini-3-pro-preview', label: 'Gemini 3 Pro (preview)' },
    'gemini-3-flash-preview': { provider: 'gemini', model: 'gemini-3-flash-preview', label: 'Gemini 3 Flash (preview)' },
    'codex-low': { provider: 'codex', model: '', reasoningEffort: 'low', label: 'Codex CLI (low)' },
    'codex-medium': { provider: 'codex', model: '', reasoningEffort: 'medium', label: 'Codex CLI (medium)' },
    'codex-high': { provider: 'codex', model: '', reasoningEffort: 'high', label: 'Codex CLI (high)' }
};

/**
 * Default auto-fallback chain order.
 */
const DEFAULT_AUTO_CHAIN = [
    'gemini-2.5-pro',
    'gemini-2.5-flash',
    'codex-medium'
];

/**
 * Build LLM fallback chain based on the user's selection.
 *
 * @param {string} llmModel - The model selected by the user ('auto', 'gemini-2.5-pro', 'codex-medium', etc.)
 * @param {ReturnType<import('../config.js').getRuntimeConfig>} runtimeConfig
 * @returns {Array<{provider: string; label: string; configKey: string; configOverrides: object}>}
 */
export function buildLlmFallbackChain(llmModel, runtimeConfig) {
    const selection = String(llmModel || 'auto').trim().toLowerCase();

    // Explicit model selection → single entry, no fallback
    if (selection !== 'auto' && LLM_MODEL_CATALOG[selection]) {
        const entry = LLM_MODEL_CATALOG[selection];
        return [buildChainEntry(entry, runtimeConfig)];
    }

    // Auto chain → ordered fallback
    const chainKeys = (process.env.CONSPECTOR_LLM_FALLBACK_CHAIN || '').trim()
        ? process.env.CONSPECTOR_LLM_FALLBACK_CHAIN.split(',').map(s => s.trim()).filter(Boolean)
        : DEFAULT_AUTO_CHAIN;

    const chain = [];
    for (const key of chainKeys) {
        if (LLM_MODEL_CATALOG[key]) {
            chain.push(buildChainEntry(LLM_MODEL_CATALOG[key], runtimeConfig));
        }
    }

    // Fallback: at least use whatever is in runtimeConfig
    if (chain.length === 0) {
        const provider = runtimeConfig.llm?.provider || 'gemini';
        const configKey = getLlmConfigKey(provider);
        chain.push({
            provider,
            label: `${provider} (default)`,
            configKey,
            configOverrides: {}
        });
    }

    return chain;
}

/**
 * @param {{provider: string; model: string; reasoningEffort?: string; label: string}} catalogEntry
 * @param {any} runtimeConfig
 */
function buildChainEntry(catalogEntry, runtimeConfig) {
    const configKey = getLlmConfigKey(catalogEntry.provider);
    const overrides = {};

    if (catalogEntry.model) {
        overrides.model = catalogEntry.model;
    }
    if (catalogEntry.reasoningEffort) {
        overrides.reasoningEffort = catalogEntry.reasoningEffort;
    }

    return {
        provider: catalogEntry.provider,
        label: catalogEntry.label,
        configKey,
        configOverrides: overrides
    };
}
