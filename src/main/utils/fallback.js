/**
 * Execute an LLM stage with automatic fallback through the chain.
 * @param {Array<{provider: string; label: string; configKey: string; configOverrides: object}>} chain
 * @param {any} runtimeConfig
 * @param {(msg: string) => void} appendWarning
 * @param {string} stageName
 * @param {(provider: string, llmConfig: any) => Promise<void>} runner
 */
export async function executeWithLlmFallback(chain, runtimeConfig, appendWarning, stageName, runner) {
    const errors = [];

    for (let i = 0; i < chain.length; i++) {
        const entry = chain[i];
        const baseConfig = runtimeConfig[entry.configKey] || {};
        const llmConfig = { ...baseConfig, ...entry.configOverrides };

        try {
            await runner(entry.provider, llmConfig);
            if (errors.length > 0) {
                appendWarning(`${stageName}: ${errors.map(e => e.label).join(', ')} failed → used ${entry.label}`);
            }
            return;
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            errors.push({ label: entry.label, error: msg });

            const isLast = i === chain.length - 1;
            if (!isLast) {
                continue; // Try next in chain
            }

            // All entries failed → try mock if allowed
            if (runtimeConfig.resilience?.codexFallbackToMock && llmConfig.mode === 'real') {
                appendWarning(
                    `${stageName}: all LLM providers failed [${errors.map(e => `${e.label}: ${e.error}`).join('; ')}], fallback to mock`
                );
                await runner(entry.provider, { ...llmConfig, mode: 'mock' });
                return;
            }

            throw error;
        }
    }
}

/**
 * Execute a task via multiple engines in order, falling back on error.
 * 
 * @param {string[]} chain - Array of engine names (e.g. ['groq', 'deepgram'])
 * @param {(engine: string) => Promise<void>} runner - Function to execute for an engine
 * @param {(engine: string, error: Error) => Promise<void>} onFallback - Called when an engine fails before trying the next
 */
export async function executeSttFallback(chain, runner, onFallback) {
    if (!chain || chain.length === 0) {
        throw new Error('STT fallback chain is empty or invalid.');
    }

    const errors = [];
    for (let i = 0; i < chain.length; i++) {
        const engine = chain[i];
        try {
            await runner(engine);
            return; // Success
        } catch (error) {
            errors.push(`${engine}: ${error instanceof Error ? error.message : String(error)}`);
            const isLast = i === chain.length - 1;
            if (!isLast && typeof onFallback === 'function') {
                await onFallback(engine, error instanceof Error ? error : new Error(String(error)));
            }
        }
    }

    throw new Error(`STT failed across all engines in chain: [${errors.join('; ')}]`);
}
