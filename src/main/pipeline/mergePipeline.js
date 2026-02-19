import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeToFlac } from '../audio/ffmpeg.js';
import { ControlledError } from '../utils/errors.js';
import { runSttDiarization } from '../workers/sttWorker.js';
import { getStructureWorker, getMergeWorker, getMergeFromMarkdownWorker, getLlmConfigKey } from '../workers/llmProvider.js';
import { renderEmergencyHtml, renderHtmlFromMarkdown } from '../workers/htmlWorker.js';
import { writeMergedToNotion } from '../workers/notionWorker.js';

/**
 * @param {{
 *   db: import('../db/database.js').AppDatabase;
 *   managedPaths: ReturnType<import('../config.js').getManagedPaths>;
 *   runtimeConfig: ReturnType<import('../config.js').getRuntimeConfig>;
 * }} deps
 */
export function createMergePipeline(deps) {
  const { db, managedPaths, runtimeConfig } = deps;

  /**
   * @param {string} jobId
   * @param {(event: { type: string; payload: any }) => void} notify
   */
  async function processJob(jobId, notify) {
    const job = db.getMergeJob(jobId);
    if (!job) {
      throw new ControlledError('JOB_NOT_FOUND', `Merge job not found: ${jobId}`);
    }

    const recording = db.getRecording(job.recording_id);
    if (!recording) {
      throw new ControlledError('RECORDING_NOT_FOUND', `Recording not found: ${job.recording_id}`);
    }

    let warning = job.warning ?? null;

    const appendWarning = (message) => {
      if (!message) {
        return;
      }
      warning = warning ? `${warning} ${message}` : message;
    };

    const stage = async (name, fn) => {
      db.updateMergeJob(jobId, name, 'running', warning);
      notify({
        type: 'job:updated',
        payload: {
          jobId,
          recordingId: recording.id,
          stage: name,
          status: 'running',
          warning
        }
      });
      await fn();
    };

    try {
      const normalizedAudioPath = path.join(managedPaths.audio, `${recording.id}.flac`);
      const transcriptPath = path.join(managedPaths.transcripts, `${recording.id}.json`);
      const structuredPath = path.join(managedPaths.structured, `${recording.id}.md`);
      const mergedPath = path.join(managedPaths.merged, `${recording.id}.md`);
      const htmlPath = path.join(managedPaths.html, `${recording.id}.html`);

      await stage('normalize_audio', async () => {
        try {
          await normalizeToFlac({
            inputPath: recording.managed_audio_path,
            outputPath: normalizedAudioPath,
            sampleRateHz: runtimeConfig.ffmpeg.sampleRateHz,
            channels: runtimeConfig.ffmpeg.channels
          });
          db.updateRecordingNormalization(recording.id, normalizedAudioPath);
        } catch (error) {
          appendWarning(
            `normalize_audio failed, using original source path: ${error instanceof Error ? error.message : 'unknown error'
            }`
          );
          db.updateRecordingNormalization(recording.id, recording.managed_audio_path);
        }
      });

      await stage('stt_diarization', async () => {
        try {
          const sttResult = await runSttDiarization({
            recording,
            normalizedAudioPath,
            transcriptPath,
            sttConfig: runtimeConfig.stt,
            onProgress: ({ percent, message, logPath }) => {
              notify({
                type: 'job:updated',
                payload: {
                  jobId,
                  recordingId: recording.id,
                  stage: 'stt_diarization',
                  status: 'running',
                  warning,
                  progressPercent: percent,
                  progressMessage: message,
                  logPath
                }
              });
            }
          });

          if (sttResult?.warning) {
            appendWarning(sttResult.warning);
          }
        } catch (error) {
          const canFallback =
            runtimeConfig.resilience.sttFallbackToMock && runtimeConfig.stt.mode === 'real';
          if (!canFallback) {
            throw error;
          }

          appendWarning(
            `stt_diarization failed, fallback to mock transcript: ${error instanceof Error ? error.message : 'unknown error'
            }`
          );
          await runSttDiarization({
            recording,
            normalizedAudioPath,
            transcriptPath,
            sttConfig: {
              ...runtimeConfig.stt,
              mode: 'mock'
            }
          });
        }
      });

      await stage('codex_structure', async () => {
        const llmConfigKey = getLlmConfigKey(runtimeConfig.llm?.provider || 'codex');
        const llmConfig = runtimeConfig[llmConfigKey];
        const runStructure = getStructureWorker(runtimeConfig.llm?.provider || 'codex');
        try {
          await runStructure({
            transcriptPath,
            structuredPath,
            recording,
            llmConfig
          });
        } catch (error) {
          const canFallback =
            runtimeConfig.resilience.codexFallbackToMock && llmConfig.mode === 'real';
          if (!canFallback) {
            throw error;
          }

          appendWarning(
            `codex_structure failed, fallback to mock: ${error instanceof Error ? error.message : 'unknown error'
            }`
          );
          await runStructure({
            transcriptPath,
            structuredPath,
            recording,
            llmConfig: {
              ...llmConfig,
              mode: 'mock'
            }
          });
        }
      });

      await stage('merge', async () => {
        const llmConfigKey = getLlmConfigKey(runtimeConfig.llm?.provider || 'codex');
        const llmConfig = runtimeConfig[llmConfigKey];
        const runMerge = getMergeWorker(runtimeConfig.llm?.provider || 'codex');
        try {
          await runMerge({
            structuredPath,
            mergedPath,
            recording,
            llmConfig
          });
        } catch (error) {
          const canFallback =
            runtimeConfig.resilience.codexFallbackToMock && llmConfig.mode === 'real';
          if (!canFallback) {
            throw error;
          }

          appendWarning(
            `merge failed, fallback to mock: ${error instanceof Error ? error.message : 'unknown error'}`
          );
          await runMerge({
            structuredPath,
            mergedPath,
            recording,
            llmConfig: {
              ...llmConfig,
              mode: 'mock'
            }
          });
        }
      });

      await stage('render_html', async () => {
        try {
          await renderHtmlFromMarkdown({
            mergedPath,
            htmlPath,
            title: recording.original_file_name ?? `Lecture ${recording.id}`
          });
        } catch (error) {
          if (!runtimeConfig.resilience.continueWithoutHtml) {
            throw error;
          }

          appendWarning(
            `render_html failed, emergency html generated: ${error instanceof Error ? error.message : 'unknown error'
            }`
          );

          try {
            await renderEmergencyHtml({
              mergedPath,
              htmlPath,
              title: recording.original_file_name ?? `Lecture ${recording.id}`,
              reason: error instanceof Error ? error.message : 'unknown error'
            });
          } catch (emergencyError) {
            appendWarning(
              `emergency html generation failed: ${emergencyError instanceof Error ? emergencyError.message : 'unknown error'
              }`
            );
          }
        }
      });

      // ─── Subject-level merge (if recording belongs to a subject) ───
      if (recording.subject_id) {
        const subjectDir = path.join(managedPaths.subjects, recording.subject_id);
        await fs.mkdir(subjectDir, { recursive: true });
        const subjectMergedPath = path.join(subjectDir, 'merged.md');
        const subjectHtmlPath = path.join(subjectDir, 'conspect.html');

        await stage('merge_subject', async () => {
          const llmConfigKey = getLlmConfigKey(runtimeConfig.llm?.provider || 'codex');
          const llmConfig = runtimeConfig[llmConfigKey];
          const runMergeFromMd = getMergeFromMarkdownWorker(runtimeConfig.llm?.provider || 'codex');

          // Read the new structured MD
          const structuredMd = await fs.readFile(structuredPath, 'utf8');

          // Read existing subject conspect (if any)
          let existingSubjectMd = '';
          try {
            existingSubjectMd = await fs.readFile(subjectMergedPath, 'utf8');
          } catch { /* first recording for this subject */ }

          try {
            await runMergeFromMd({
              structuredMarkdown: structuredMd,
              baseMarkdown: existingSubjectMd,
              outputPath: subjectMergedPath,
              recording,
              llmConfig
            });
          } catch (error) {
            const canFallback =
              runtimeConfig.resilience.codexFallbackToMock && llmConfig.mode === 'real';
            if (!canFallback) {
              throw error;
            }
            appendWarning(
              `merge_subject failed, fallback to mock: ${error instanceof Error ? error.message : 'unknown error'}`
            );
            await runMergeFromMd({
              structuredMarkdown: structuredMd,
              baseMarkdown: existingSubjectMd,
              outputPath: subjectMergedPath,
              recording,
              llmConfig: { ...llmConfig, mode: 'mock' }
            });
          }
        });

        await stage('render_subject_html', async () => {
          const subjectName = db.getSubject?.(recording.subject_id)?.name || 'Конспект';
          try {
            await renderHtmlFromMarkdown({
              mergedPath: subjectMergedPath,
              htmlPath: subjectHtmlPath,
              title: subjectName
            });
          } catch (error) {
            if (!runtimeConfig.resilience.continueWithoutHtml) {
              throw error;
            }
            appendWarning(
              `render_subject_html failed: ${error instanceof Error ? error.message : 'unknown error'}`
            );
            try {
              await renderEmergencyHtml({
                mergedPath: subjectMergedPath,
                htmlPath: subjectHtmlPath,
                title: subjectName,
                reason: error instanceof Error ? error.message : 'unknown error'
              });
            } catch (emergencyError) {
              appendWarning(
                `emergency subject html failed: ${emergencyError instanceof Error ? emergencyError.message : 'unknown error'}`
              );
            }
          }
        });
      }

      await stage('notion_writeback', async () => {
        if (runtimeConfig.notion?.mode !== 'real') {
          // In web mode we intentionally keep auto-writeback disabled.
          return;
        }

        try {
          const llmProvider = runtimeConfig.llm?.provider || 'codex';
          const llmConfigKey = getLlmConfigKey(llmProvider);

          // Use subject name as Notion page title if recording belongs to a subject
          const notionConfig = { ...runtimeConfig.notion };
          if (recording.subject_id) {
            const subject = db.getSubject?.(recording.subject_id);
            if (subject?.name) {
              notionConfig.pageTitle = subject.name;
            }
          }
          // Fallback: use recording file name if no subject and no explicit title
          if (!notionConfig.pageTitle) {
            const baseName = String(recording.original_file_name || '')
              .replace(/\.[^./\\]+$/, '').trim();
            if (baseName) {
              notionConfig.pageTitle = baseName;
            }
          }

          const result = await writeMergedToNotion({
            mergedPath,
            recording,
            backupsDir: managedPaths.backups,
            notionConfig,
            llmMergeFromMarkdown: getMergeFromMarkdownWorker(llmProvider),
            llmConfig: runtimeConfig[llmConfigKey]
          });

          if (result?.warning) {
            appendWarning(result.warning);
          }
        } catch (error) {
          if (!runtimeConfig.resilience.notionSoftFail) {
            throw error;
          }
          appendWarning(
            `notion_writeback skipped after error: ${error instanceof Error ? error.message : 'unknown error'
            }`
          );
        }
      });

      db.completeMergeJob(jobId, warning);
      notify({
        type: 'job:updated',
        payload: {
          jobId,
          recordingId: recording.id,
          stage: 'done',
          status: 'done',
          warning
        }
      });
    } catch (error) {
      const code = error instanceof ControlledError ? error.code : 'PIPELINE_STAGE_FAILED';
      const message = error instanceof Error ? error.message : 'Pipeline failed';
      const failedStage = db.getMergeJob(jobId)?.stage ?? 'unknown';
      db.failMergeJob(jobId, failedStage, code, message);
      notify({
        type: 'job:updated',
        payload: {
          jobId,
          recordingId: recording.id,
          stage: failedStage,
          status: 'failed',
          warning,
          error: { code, message }
        }
      });
      throw error;
    }
  }

  return {
    processJob
  };
}
