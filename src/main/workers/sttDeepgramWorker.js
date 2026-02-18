import fs from 'node:fs/promises';
import { openAsBlob } from 'node:fs';
import path from 'node:path';
import { ControlledError } from '../utils/errors.js';

const DEEPGRAM_BASE = 'https://api.deepgram.com/v1';

/**
 * Convert Deepgram response to our internal segment format.
 */
function toSegments(deepgramResult) {
    const segments = [];
    const channels = deepgramResult?.results?.channels;

    if (!Array.isArray(channels) || channels.length === 0) {
        return segments;
    }

    // Use utterances if available (more natural grouping)
    const utterances = deepgramResult?.results?.utterances;
    if (Array.isArray(utterances) && utterances.length > 0) {
        for (const utt of utterances) {
            const text = String(utt.transcript || '').trim();
            if (!text) continue;
            segments.push({
                startSec: Number(utt.start) || 0,
                endSec: Number(utt.end) || 0,
                speakerId: `SPEAKER_${utt.speaker != null ? utt.speaker + 1 : 1}`,
                text
            });
        }
        return segments;
    }

    // Fallback: use channel alternatives
    const channel = channels[0];
    const alternatives = channel?.alternatives;
    if (!Array.isArray(alternatives) || alternatives.length === 0) {
        return segments;
    }

    const alt = alternatives[0];

    // Try paragraphs if available
    if (alt.paragraphs?.paragraphs?.length > 0) {
        for (const para of alt.paragraphs.paragraphs) {
            for (const sentence of (para.sentences || [])) {
                const text = String(sentence.text || '').trim();
                if (!text) continue;
                segments.push({
                    startSec: Number(sentence.start) || 0,
                    endSec: Number(sentence.end) || 0,
                    speakerId: `SPEAKER_${para.speaker != null ? para.speaker + 1 : 1}`,
                    text
                });
            }
        }
        if (segments.length > 0) return segments;
    }

    // Final fallback: full transcript
    const text = String(alt.transcript || '').trim();
    if (text) {
        const duration = deepgramResult?.metadata?.duration || 1;
        segments.push({
            startSec: 0,
            endSec: duration,
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
 *     deepgramApiKey: string;
 *     deepgramModel: string;
 *   };
 *   onProgress?: (payload: { percent: number; message: string; }) => void;
 *   onLog?: (streamName: string, text: string) => void;
 * }} payload
 */
export async function runDeepgramTranscription(payload) {
    const { inputPath, transcriptPath, recordingId, sttConfig, onProgress, onLog } = payload;

    const apiKey = String(sttConfig.deepgramApiKey || '').trim();
    if (!apiKey) {
        throw new ControlledError('DEEPGRAM_API_KEY_MISSING', 'DEEPGRAM_API_KEY is not configured');
    }

    const stat = await fs.stat(inputPath).catch(() => null);
    if (!stat || !stat.isFile()) {
        throw new ControlledError('DEEPGRAM_INPUT_NOT_FOUND', `Input audio file not found: ${inputPath}`);
    }

    const model = String(sttConfig.deepgramModel || 'nova-2').trim();
    const language = String(sttConfig.language || 'ru').trim();

    if (typeof onProgress === 'function') {
        onProgress({ percent: 22, message: 'deepgram_prepare' });
    }

    const fileName = path.basename(inputPath);
    const ext = path.extname(inputPath).toLowerCase().replace('.', '');
    const mimeMap = {
        flac: 'audio/flac',
        wav: 'audio/wav',
        mp3: 'audio/mpeg',
        m4a: 'audio/mp4',
        ogg: 'audio/ogg',
        webm: 'audio/webm'
    };
    const contentType = mimeMap[ext] || 'audio/flac';

    if (typeof onLog === 'function') {
        onLog('stdout', `deepgram uploading: ${fileName} (${(stat.size / 1024 / 1024).toFixed(1)} MB) model=${model} lang=${language}\n`);
    }

    if (typeof onProgress === 'function') {
        onProgress({ percent: 30, message: 'deepgram_transcribing' });
    }

    // Deepgram pre-recorded API: send binary audio, get result synchronously
    const queryParams = new URLSearchParams({
        model,
        language,
        punctuate: 'true',
        utterances: 'true',
        smart_format: 'true',
        paragraphs: 'true'
    });

    const fileBlob = await openAsBlob(inputPath);

    const controller = new AbortController();
    const timeoutMs = Math.max(sttConfig.timeoutMs || 1800000, 120000);
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let response;
    try {
        response = await fetch(`${DEEPGRAM_BASE}/listen?${queryParams.toString()}`, {
            method: 'POST',
            headers: {
                Authorization: `Token ${apiKey}`,
                'Content-Type': contentType
            },
            body: fileBlob,
            signal: controller.signal
        });
    } catch (err) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
            throw new ControlledError('DEEPGRAM_TIMEOUT', `Deepgram request timed out after ${timeoutMs / 1000}s`);
        }
        throw err;
    }
    clearTimeout(timeoutId);

    if (!response.ok) {
        const bodyText = await response.text();
        throw new ControlledError(
            'DEEPGRAM_STT_FAILED',
            `Deepgram STT failed (${response.status}): ${bodyText.slice(0, 300)}`
        );
    }

    const result = await response.json();

    if (typeof onLog === 'function') {
        const duration = result?.metadata?.duration || 0;
        onLog('stdout', `deepgram transcription complete: duration=${duration.toFixed(1)}s\n`);
    }

    if (typeof onProgress === 'function') {
        onProgress({ percent: 90, message: 'deepgram_processing_result' });
    }

    // Convert
    const segments = toSegments(result);
    if (segments.length === 0) {
        throw new ControlledError('DEEPGRAM_EMPTY_TRANSCRIPT', 'Deepgram returned empty transcript');
    }

    const output = {
        recordingId,
        language,
        model: `deepgram-${model}`,
        diarization: false,
        sttEngine: 'deepgram',
        segments
    };

    await fs.writeFile(transcriptPath, JSON.stringify(output, null, 2), 'utf8');
    if (typeof onProgress === 'function') {
        onProgress({ percent: 100, message: 'deepgram_done' });
    }
    return output;
}
