import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import crypto from 'node:crypto';

export async function ensureDir(pathname) {
  await fs.mkdir(pathname, { recursive: true });
}

export async function ensureDirs(paths) {
  await Promise.all(paths.map((p) => ensureDir(p)));
}

export async function hashFileSha256(pathname) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = createReadStream(pathname);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

export function safeParseJson(input) {
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}
