import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeToFlac } from '../audio/ffmpeg.js';
import { ControlledError } from '../utils/errors.js';
import { runSttDiarization } from '../workers/sttWorker.js';
import { getStructureWorker, getMergeWorker, getMergeFromMarkdownWorker, getContextWorker, getReviewWorker, getLlmConfigKey, buildLlmFallbackChain } from '../workers/llmProvider.js';
import { renderEmergencyHtml, renderHtmlFromMarkdown } from '../workers/htmlWorker.js';
import { writeMergedToNotion } from '../workers/notionWorker.js';
import { executeWithLlmFallback } from '../utils/fallback.js';

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

      // Build LLM chain once (from per-job model selection or auto)
      const llmModel = recording.llm_model || 'auto';
      const llmChain = buildLlmFallbackChain(llmModel, runtimeConfig);

      await stage('codex_structure', async () => {
        // Read subject context if recording belongs to a subject
        let subjectContext = '';
        if (recording.subject_id) {
          const contextPath = path.join(managedPaths.subjects, recording.subject_id, 'context.md');
          try { subjectContext = await fs.readFile(contextPath, 'utf8'); } catch { /* no context yet */ }
        }

        await executeWithLlmFallback(llmChain, runtimeConfig, appendWarning, 'codex_structure', async (provider, llmConfig) => {
          const runStructure = getStructureWorker(provider);
          await runStructure({ transcriptPath, structuredPath, recording, subjectContext, llmConfig });
        });
      });

      await stage('merge', async () => {
        await executeWithLlmFallback(llmChain, runtimeConfig, appendWarning, 'merge', async (provider, llmConfig) => {
          const runMerge = getMergeWorker(provider);
          await runMerge({ structuredPath, mergedPath, recording, llmConfig });
        });
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

      // ─── Subject-level multi-pass pipeline ───
      if (recording.subject_id) {
        const subjectDir = path.join(managedPaths.subjects, recording.subject_id);
        const pagesDir = path.join(subjectDir, 'pages');
        await fs.mkdir(pagesDir, { recursive: true });
        const contextPath = path.join(subjectDir, 'context.md');
        const subjectMergedPath = path.join(subjectDir, 'merged.md');
        const subjectHtmlPath = path.join(subjectDir, 'conspect.html');

        // ─── Pass 1: Save structured output as individual page ───
        let pageNumber;
        let pagePath;
        await stage('save_page', async () => {
          // Determine page number from existing pages
          const existingPages = await fs.readdir(pagesDir).catch(() => []);
          const pageFiles = existingPages
            .filter(f => /^\d+\.md$/.test(f))
            .sort();
          pageNumber = pageFiles.length + 1;
          const paddedNum = String(pageNumber).padStart(3, '0');
          pagePath = path.join(pagesDir, `${paddedNum}.md`);

          // Copy structured markdown as the new page
          const structuredMd = await fs.readFile(structuredPath, 'utf8');
          await fs.writeFile(pagePath, structuredMd, 'utf8');
        });

        // ─── Pass 2: Update context.md navigation map ───
        await stage('update_context', async () => {
          const pageMarkdown = await fs.readFile(pagePath, 'utf8');
          let existingContext = '';
          try {
            existingContext = await fs.readFile(contextPath, 'utf8');
          } catch { /* first page — context doesn't exist yet */ }

          await executeWithLlmFallback(llmChain, runtimeConfig, appendWarning, 'update_context', async (provider, llmConfig) => {
            const runContext = getContextWorker(provider);
            await runContext({
              pageMarkdown,
              existingContext,
              pageNumber,
              outputPath: contextPath,
              llmConfig
            });
          });
        });

        // ─── Programmatic concatenation of all pages ───
        await stage('concat_pages', async () => {
          const allFiles = await fs.readdir(pagesDir);
          const pageFiles = allFiles
            .filter(f => /^\d+\.md$/.test(f))
            .sort();

          // Read context.md for the table of contents header
          let contextMd = '';
          try {
            contextMd = await fs.readFile(contextPath, 'utf8');
          } catch { /* no context yet */ }

          const parts = [];

          // Add context as TOC header if it exists
          if (contextMd.trim()) {
            parts.push(contextMd.trim());
            parts.push('\n\n---\n\n');
          }

          // Concatenate all pages
          for (let i = 0; i < pageFiles.length; i++) {
            const pageContent = await fs.readFile(path.join(pagesDir, pageFiles[i]), 'utf8');
            if (i > 0) parts.push('\n\n---\n\n');
            parts.push(pageContent.trim());
          }

          await fs.writeFile(subjectMergedPath, parts.join(''), 'utf8');
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

        // ─── Quality review loop: critique → fix → repeat ───
        await stage('review_quality', async () => {
          const MAX_REVIEW_ITERATIONS = 3;
          const reviewLogPath = path.join(subjectDir, 'review.json');

          for (let iteration = 1; iteration <= MAX_REVIEW_ITERATIONS; iteration++) {
            // Read current merged content
            const mergedContent = await fs.readFile(subjectMergedPath, 'utf8');
            const reviewOutputPath = path.join(subjectDir, `review_${iteration}.json`);

            // Ask LLM to review
            try {
              await executeWithLlmFallback(llmChain, runtimeConfig, appendWarning, 'review_quality', async (provider, llmConfig) => {
                const runReview = getReviewWorker(provider);
                await runReview({
                  mergedMarkdown: mergedContent,
                  outputPath: reviewOutputPath,
                  llmConfig
                });
              });
            } catch (reviewError) {
              appendWarning(`review iteration ${iteration} failed: ${reviewError instanceof Error ? reviewError.message : 'unknown'}`);
              break;
            }

            // Parse review result
            let reviewResult;
            try {
              const rawReview = await fs.readFile(reviewOutputPath, 'utf8');
              // Strip markdown code fences if LLM wrapped the JSON
              const cleaned = rawReview.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
              reviewResult = JSON.parse(cleaned);
            } catch {
              appendWarning(`review iteration ${iteration}: could not parse review JSON`);
              break;
            }

            // Save review log
            await fs.writeFile(reviewLogPath, JSON.stringify(reviewResult, null, 2), 'utf8');

            // Check if no critical issues
            const criticalIssues = (reviewResult.issues || []).filter(i => i.severity === 'critical');
            if (criticalIssues.length === 0) {
              break; // All good — exit loop
            }

            // Apply find/replace patches from critical issues
            let fixedContent = mergedContent;
            let appliedFixes = 0;
            for (const issue of criticalIssues) {
              if (issue.find && issue.replace !== undefined && fixedContent.includes(issue.find)) {
                fixedContent = fixedContent.replace(issue.find, issue.replace);
                appliedFixes++;
              }
            }

            if (appliedFixes === 0) {
              appendWarning(`review iteration ${iteration}: ${criticalIssues.length} critical issues found but no patches could be applied`);
              break;
            }

            // Write fixed content back
            await fs.writeFile(subjectMergedPath, fixedContent, 'utf8');

            // Re-render HTML after fixes
            const subjectName = db.getSubject?.(recording.subject_id)?.name || 'Конспект';
            try {
              await renderHtmlFromMarkdown({
                mergedPath: subjectMergedPath,
                htmlPath: subjectHtmlPath,
                title: subjectName
              });
            } catch { /* non-critical — HTML can be regenerated later */ }
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
            mergedPath: recording.subject_id
              ? path.join(managedPaths.subjects, recording.subject_id, 'merged.md')
              : mergedPath,
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
