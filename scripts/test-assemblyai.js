#!/usr/bin/env node
/**
 * scripts/test-assemblyai.js
 *
 * Diagnostic script: tests AssemblyAI API directly using CONSPECTOR_ASSEMBLYAI_KEY from .env
 * Usage: node scripts/test-assemblyai.js
 *
 * Что проверяет:
 *  1. Читает CONSPECTOR_ASSEMBLYAI_KEY из .env (без dotenv).
 *  2. Отправляет запрос транскрипции с параметрами: speech_models + language_code=ru.
 *  3. Поллит до результата (макс. 5 минут).
 *  4. Выводит весь payload запроса, статус ответа и первые 500 символов транскрипта.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// --- Загрузка .env вручную (без dotenv, чтобы не добавлять зависимость) ---
function loadEnv(envPath) {
    let raw;
    try {
        raw = readFileSync(envPath, 'utf8');
    } catch {
        console.error(`[test-assemblyai] .env not found at ${envPath} — trying process.env directly`);
        return;
    }
    for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
        if (!process.env[key]) process.env[key] = val;
    }
}

loadEnv(resolve(ROOT, '.env'));

const ASSEMBLYAI_BASE = 'https://api.assemblyai.com/v2';
const API_KEY = (process.env.CONSPECTOR_ASSEMBLYAI_KEY || '').trim();

if (!API_KEY) {
    console.error('[test-assemblyai] CONSPECTOR_ASSEMBLYAI_KEY is not set. Exiting.');
    process.exit(1);
}

// Публичный короткий аудио-файл от AssemblyAI — для диагностики.
// Тестируем с language_code=ru, чтобы воспроизвести ошибку.
const TEST_AUDIO_URL = 'https://assembly.ai/wildfires.mp3';

async function main() {
    console.log('[test-assemblyai] === AssemblyAI Direct API Test ===');
    console.log(`[test-assemblyai] API key: ...${API_KEY.slice(-6)}`);
    console.log(`[test-assemblyai] Audio URL: ${TEST_AUDIO_URL}`);

    const submitPayload = {
        audio_url: TEST_AUDIO_URL,
        language_code: 'ru',
        punctuate: true,
        format_text: true,
        speech_models: ['universal-3-pro', 'universal-2']
    };

    console.log('[test-assemblyai] Submit payload:', JSON.stringify(submitPayload, null, 2));

    // Submit
    const submitResp = await fetch(`${ASSEMBLYAI_BASE}/transcript`, {
        method: 'POST',
        headers: {
            Authorization: API_KEY,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(submitPayload)
    });

    const submitBody = await submitResp.text();
    console.log(`[test-assemblyai] Submit HTTP status: ${submitResp.status}`);
    console.log('[test-assemblyai] Submit response body:', submitBody);

    if (!submitResp.ok) {
        console.error('[test-assemblyai] Submit FAILED — see body above for AssemblyAI error details.');
        process.exit(2);
    }

    const submitData = JSON.parse(submitBody);
    const transcriptId = submitData.id;
    console.log(`[test-assemblyai] Transcript ID: ${transcriptId}, initial status: ${submitData.status}`);

    // Poll
    const POLL_INTERVAL_MS = 5000;
    const MAX_ATTEMPTS = 60; // 5 min max

    for (let i = 0; i < MAX_ATTEMPTS; i++) {
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));

        const pollResp = await fetch(`${ASSEMBLYAI_BASE}/transcript/${transcriptId}`, {
            headers: { Authorization: API_KEY }
        });

        if (!pollResp.ok) {
            const pollBody = await pollResp.text();
            console.error(`[test-assemblyai] Poll failed (${pollResp.status}): ${pollBody}`);
            process.exit(3);
        }

        const pollData = await pollResp.json();
        console.log(`[test-assemblyai] Poll attempt ${i + 1}: status=${pollData.status}`);

        if (pollData.status === 'completed') {
            const text = (pollData.text || '').slice(0, 500);
            console.log('[test-assemblyai] ✅ Transcript completed!');
            console.log(`[test-assemblyai] Text preview (first 500 chars): ${text}`);
            console.log(`[test-assemblyai] Words count: ${(pollData.words || []).length}`);
            process.exit(0);
        }

        if (pollData.status === 'error') {
            console.error(`[test-assemblyai] ❌ Transcription error: ${pollData.error}`);
            process.exit(4);
        }
    }

    console.error('[test-assemblyai] Polling timed out after 5 minutes.');
    process.exit(5);
}

main().catch(err => {
    console.error('[test-assemblyai] Unexpected error:', err);
    process.exit(99);
});
