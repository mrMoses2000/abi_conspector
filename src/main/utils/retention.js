import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * @param {{ directories: string[]; days: number; }} payload
 */
export async function cleanupOldFiles(payload) {
  const cutoffMs = Date.now() - payload.days * 24 * 60 * 60 * 1000;

  for (const dir of payload.directories) {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }

      const fullPath = path.join(dir, entry.name);
      const stat = await fs.stat(fullPath).catch(() => null);
      if (!stat) {
        continue;
      }

      if (stat.mtimeMs < cutoffMs) {
        await fs.unlink(fullPath).catch(() => undefined);
      }
    }
  }
}
