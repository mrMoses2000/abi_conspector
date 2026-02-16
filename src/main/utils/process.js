import { spawn } from 'node:child_process';
import { ControlledError } from './errors.js';

/**
 * @param {{
 *   command: string;
 *   args: string[];
 *   cwd?: string;
 *   env?: Record<string, string | undefined>;
 *   stdin?: string;
 *   timeoutMs?: number;
 * }} payload
 */
export async function runCommand(payload) {
  const {
    command,
    args,
    cwd = process.cwd(),
    env = process.env,
    stdin = '',
    timeoutMs = 5 * 60 * 1000
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
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
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
        const details = (stderr || stdout || '').trim();
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
