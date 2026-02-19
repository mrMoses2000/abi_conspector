import { spawn } from 'node:child_process';
import { ControlledError } from './errors.js';

/**
 * Prefer actionable tail lines and suppress noisy runtime warnings (e.g. Node DEP warnings)
 * so UI shows the real failure reason instead of warning prelude.
 * @param {string} stderr
 * @param {string} stdout
 */
export function summarizeProcessFailure(stderr, stdout) {
  const raw = String(stderr || stdout || '').trim();
  if (!raw) {
    return '';
  }

  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const noisePatterns = [
    /^\(node:\d+\)\s+\[DEP\d+\]/i,
    /^DeprecationWarning:/i
  ];

  const filtered = lines.filter((line) => !noisePatterns.some((rx) => rx.test(line)));
  const source = filtered.length > 0 ? filtered : lines;
  const tail = source.slice(-8).join(' | ');

  return tail.length > 1400 ? `${tail.slice(0, 1400)}...` : tail;
}

/**
 * @param {{
 *   command: string;
 *   args: string[];
 *   cwd?: string;
 *   env?: Record<string, string | undefined>;
 *   stdin?: string;
 *   timeoutMs?: number;
 *   onStdout?: (chunk: string) => void;
 *   onStderr?: (chunk: string) => void;
 * }} payload
 */
export async function runCommand(payload) {
  const {
    command,
    args,
    cwd = process.cwd(),
    env = process.env,
    stdin = '',
    timeoutMs = 5 * 60 * 1000,
    onStdout = null,
    onStderr = null
  } = payload;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (typeof onStdout === 'function') {
        onStdout(text);
      }
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (typeof onStderr === 'function') {
        onStderr(text);
      }
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(new ControlledError('PROCESS_START_FAILED', `${command}: ${error.message}`));
    });

    child.on('close', (code) => {
      clearTimeout(timer);

      if (timedOut) {
        reject(new ControlledError('PROCESS_TIMEOUT', `${command} timed out after ${timeoutMs} ms`));
        return;
      }

      if (code !== 0) {
        const details = summarizeProcessFailure(stderr, stdout);
        reject(new ControlledError('PROCESS_FAILED', `${command} exited with code ${code}${details ? `: ${details}` : ''}`));
        return;
      }

      resolve({ stdout, stderr });
    });

    if (stdin) {
      child.stdin.write(stdin);
    }
    child.stdin.end();
  });
}
