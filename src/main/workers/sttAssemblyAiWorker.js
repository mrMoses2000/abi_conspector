import fs from 'node:fs/promises';
import { openAsBlob } from 'node:fs';
import path from 'node:path';
import { ControlledError } from '../utils/errors.js';

const ASSEMBLYAI_BASE = 'https://api.assemblyai.com/v2';
const POLL_INTERVAL_MS = 5000;
const MAX_POLL_ATTEMPTS = 720; // 60 minutes max polling

/**
 * Upload local file to AssemblyAI and return the upload URL.
 */
async function uploadToAssemblyAi(filePath, apiKey, onLog) {
    const fileBlob = await openAsBlob(filePath);
    const fileName = path.basename(filePath);

    if (typeof onLog === 'function') {
        onLog('stdout', `assemblyai uploading file: ${fileName} (${(fileBlob.size / 1024 / 1024).toFixed(1)} MB)\n`);
    }

    const response = await fetch(`${ASSEMBLYAI_BASE}/upload`, {
        method: 'POST',
        headers: {
            Authorization: apiKey,
            'Content-Type': 'application/octet-stream'
        },
        body: fileBlob
    });

    if (!response.ok) {
        const bodyText = await response.text();
        throw new ControlledError(
            'ASSEMBLYAI_UPLOAD_FAILED',
            `AssemblyAI upload failed (${response.status}): ${bodyText.slice(0, 300)}`
        );
    }

    const data = await response.json();
    if (!data.upload_url) {
        throw new ControlledError('ASSEMBLYAI_UPLOAD_FAILED', 'AssemblyAI upload returned no upload_url');
    }

    if (typeof onLog === 'function') {
        onLog('stdout', `assemblyai upload complete: ${data.upload_url.slice(0, 60)}...\n`);
    }

    return data.upload_url;
}

/**
 * Submit transcription job and return transcript ID.
 */
async function submitTranscription(uploadUrl, apiKey, language, onLog) {
    const body = {
        audio_url: uploadUrl,
        language_code: language || 'ru',
        punctuate: true,
        format_text: true,
        speech_models: ['universal-3-pro']
    };

    const response = await fetch(`${ASSEMBLYAI_BASE}/transcript`, {
        method: 'POST',
        headers: {
            Authorization: apiKey,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const bodyText = await response.text();
        throw new ControlledError(
            'ASSEMBLYAI_SUBMIT_FAILED',
            `AssemblyAI submit failed (${response.status}): ${bodyText.slice(0, 300)}`
        );
    }

    const data = await response.json();
    if (!data.id) {
        throw new ControlledError('ASSEMBLYAI_SUBMIT_FAILED', 'AssemblyAI returned no transcript id');
    }

    if (typeof onLog === 'function') {
        onLog('stdout', `assemblyai transcript submitted: id=${data.id} status=${data.status}\n`);
    }

    return data.id;
}

/**
 * Poll until transcript is completed or errored.
 */
async function pollTranscript(transcriptId, apiKey, onLog, onProgress) {
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

        const response = await fetch(`${ASSEMBLYAI_BASE}/transcript/${transcriptId}`, {
            headers: { Authorization: apiKey }
        });

        if (!response.ok) {
            const bodyText = await response.text();
            throw new ControlledError(
                'ASSEMBLYAI_POLL_FAILED',
                `AssemblyAI poll failed (${response.status}): ${bodyText.slice(0, 300)}`
            );
        }

        const data = await response.json();

        if (data.status === 'completed') {
            if (typeof onLog === 'function') {
                onLog('stdout', `assemblyai transcript completed: ${(data.text || '').length} chars\n`);
            }
            return data;
        }

        if (data.status === 'error') {
            throw new ControlledError(
                'ASSEMBLYAI_TRANSCRIPTION_ERROR',
                `AssemblyAI transcription error: ${data.error || 'unknown'}`
            );
        }

        // Still processing
        if (typeof onProgress === 'function' && attempt % 6 === 0) {
            const pct = Math.min(90, 30 + Math.floor((attempt / MAX_POLL_ATTEMPTS) * 60));
            onProgress({ percent: pct, message: `assemblyai_polling_${data.status}` });
        }
        if (typeof onLog === 'function' && attempt % 12 === 0) {
            onLog('stdout', `assemblyai polling: attempt=${attempt + 1} status=${data.status}\n`);
        }
    }

    throw new ControlledError(
        'ASSEMBLYAI_POLL_TIMEOUT',
        `AssemblyAI polling timed out after ${MAX_POLL_ATTEMPTS} attempts`
    );
}

/**
 * Convert AssemblyAI response to our internal segment format.
 */
function toSegments(transcriptData) {
    const segments = [];

    // AssemblyAI returns words array with start/end in milliseconds
    if (Array.isArray(transcriptData.words) && transcriptData.words.length > 0) {
        // Group words into sentences by splitting on sentence-ending punctuation
        let currentText = '';
        let currentStart = transcriptData.words[0].start / 1000;
        let currentEnd = currentStart;

        for (const word of transcriptData.words) {
            const wordText = String(word.text || '').trim();
            if (!wordText) continue;

            if (!currentText) {
                currentStart = word.start / 1000;
            }
            currentText += (currentText ? ' ' : '') + wordText;
            currentEnd = word.end / 1000;

            // Split on sentence-ending punctuation
            if (/[.!?]\s*$/.test(wordText)) {
                segments.push({
                    startSec: currentStart,
                    endSec: currentEnd,
                    speakerId: `SPEAKER_${word.speaker || 1}`,
                    text: currentText.trim()
                });
                currentText = '';
            }
        }

        // Push remaining text
        if (currentText.trim()) {
            segments.push({
                startSec: currentStart,
                endSec: currentEnd,
                speakerId: 'SPEAKER_1',
                text: currentText.trim()
            });
        }

        return segments;
    }

    // Fallback: use full text
    const text = String(transcriptData.text || '').trim();
    if (text) {
        segments.push({
            startSec: 0,
            endSec: (transcriptData.audio_duration || 1),
            speakerId: 'SPEAKER_1',
            text
        });
    }

    return segments;
}

/**
 * @param {{
 *   inputPath: string;
 *   transcriptPath: string;
 *   recordingId: string;
 *   sttConfig: {
 *     language: string;
 *     timeoutMs: number;
 *     assemblyaiApiKey: string;
 *   };
 *   onProgress?: (payload: { percent: number; message: string; }) => void;
 *   onLog?: (streamName: string, text: string) => void;
 * }} payload
 */
export async function runAssemblyAiTranscription(payload) {
    const { inputPath, transcriptPath, recordingId, sttConfig, onProgress, onLog } = payload;

    const apiKey = String(sttConfig.assemblyaiApiKey || '').trim();
    if (!apiKey) {
        throw new ControlledError('ASSEMBLYAI_API_KEY_MISSING', 'ASSEMBLYAI_API_KEY is not configured');
    }

    const stat = await fs.stat(inputPath).catch(() => null);
    if (!stat || !stat.isFile()) {
        throw new ControlledError('ASSEMBLYAI_INPUT_NOT_FOUND', `Input audio file not found: ${inputPath}`);
    }

    if (typeof onProgress === 'function') {
        onProgress({ percent: 22, message: 'assemblyai_upload' });
    }

    // Step 1: Upload
    const uploadUrl = await uploadToAssemblyAi(inputPath, apiKey, onLog);

    if (typeof onProgress === 'function') {
        onProgress({ percent: 28, message: 'assemblyai_submit' });
    }

    // Step 2: Submit
    const transcriptId = await submitTranscription(uploadUrl, apiKey, sttConfig.language, onLog);

    if (typeof onProgress === 'function') {
        onProgress({ percent: 30, message: 'assemblyai_processing' });
    }

    // Step 3: Poll
    const transcriptData = await pollTranscript(transcriptId, apiKey, onLog, onProgress);

    // Step 4: Convert
    const segments = toSegments(transcriptData);
    if (segments.length === 0) {
        throw new ControlledError('ASSEMBLYAI_EMPTY_TRANSCRIPT', 'AssemblyAI returned empty transcript');
    }

    const output = {
        recordingId,
        language: sttConfig.language || 'ru',
        model: 'assemblyai-universal',
        diarization: false,
        sttEngine: 'assemblyai',
        segments
    };

    await fs.writeFile(transcriptPath, JSON.stringify(output, null, 2), 'utf8');
    if (typeof onProgress === 'function') {
        onProgress({ percent: 100, message: 'assemblyai_done' });
    }
    return output;
}
