import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import test from 'node:test';

const TEST_TIMEOUT_MS = 25_000;
const START_TIMEOUT_MS = 10_000;

async function getFreePort() {
  return await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (!address || typeof address === 'string') {
        probe.close(() => reject(new Error('failed to allocate free port')));
        return;
      }
      const { port } = address;
      probe.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function waitForServer(baseUrl, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // Ignore while server is booting.
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error(`web server did not start within ${timeoutMs}ms`);
}

async function readJson(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

test(
  'web server auth/roles/endpoints',
  { timeout: TEST_TIMEOUT_MS },
  async (t) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'abi-web-test-'));
    const dataRoot = path.join(tempRoot, 'data');
    const htmlDir = path.join(dataRoot, 'html');
    const mergedDir = path.join(dataRoot, 'merged');
    await fs.mkdir(htmlDir, { recursive: true });
    await fs.mkdir(mergedDir, { recursive: true });

    const fixtureRecordingId = 'rec_fixture_001';
    await fs.writeFile(path.join(htmlDir, `${fixtureRecordingId}.html`), '<html><body>ok</body></html>', 'utf8');
    await fs.writeFile(path.join(mergedDir, `${fixtureRecordingId}.md`), '# fixture\n', 'utf8');

    const port = await getFreePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const webDbPath = path.join(tempRoot, 'web.db');
    const env = {
      ...process.env,
      CONSPECTOR_DATA_ROOT: dataRoot,
      CONSPECTOR_WEB_DB_PATH: webDbPath,
      CONSPECTOR_WEB_PORT: String(port),
      CONSPECTOR_ADMIN_EMAILS: 'admin@example.com',
      CONSPECTOR_WEB_SESSION_DAYS: '30',
      CONSPECTOR_NOTION_MODE: 'off'
    };

    const child = spawn(process.execPath, ['-r', 'dotenv/config', 'web/server.js'], {
      cwd: process.cwd(),
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let childLog = '';
    child.stdout.on('data', (chunk) => {
      childLog += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      childLog += chunk.toString('utf8');
    });

    const stopChild = async () => {
      if (child.killed) {
        return;
      }
      child.kill('SIGTERM');
      await Promise.race([
        once(child, 'exit'),
        new Promise((resolve) => setTimeout(resolve, 1500))
      ]);
      if (!child.killed) {
        child.kill('SIGKILL');
      }
    };

    t.after(async () => {
      await stopChild();
      await fs.rm(tempRoot, { recursive: true, force: true });
    });

    await waitForServer(baseUrl, START_TIMEOUT_MS);

    const unauthorized = await fetch(`${baseUrl}/api/conspects`);
    assert.equal(unauthorized.status, 401);
    const unauthorizedPayload = await readJson(unauthorized);
    assert.equal(unauthorizedPayload.error, 'AUTH_REQUIRED');

    const registerAdmin = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@example.com',
        password: 'password123'
      })
    });
    assert.equal(registerAdmin.status, 201);
    const adminPayload = await readJson(registerAdmin);
    assert.equal(adminPayload.ok, true);
    assert.equal(adminPayload.user.role, 'admin');
    const adminToken = adminPayload.token;
    assert.ok(adminToken);

    const registerUser = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'user@example.com',
        password: 'password123'
      })
    });
    assert.equal(registerUser.status, 201);
    const userPayload = await readJson(registerUser);
    assert.equal(userPayload.user.role, 'user');
    const userToken = userPayload.token;

    const me = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(me.status, 200);
    const mePayload = await readJson(me);
    assert.equal(mePayload.user.email, 'admin@example.com');
    assert.equal(mePayload.user.role, 'admin');

    const usersAsNormal = await fetch(`${baseUrl}/api/admin/users`, {
      headers: { Authorization: `Bearer ${userToken}` }
    });
    assert.equal(usersAsNormal.status, 403);
    const usersAsNormalPayload = await readJson(usersAsNormal);
    assert.equal(usersAsNormalPayload.error, 'FORBIDDEN');

    const usersAsAdmin = await fetch(`${baseUrl}/api/admin/users`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(usersAsAdmin.status, 200);
    const usersAsAdminPayload = await readJson(usersAsAdmin);
    assert.equal(usersAsAdminPayload.ok, true);
    assert.equal(usersAsAdminPayload.users.length, 2);

    const conspects = await fetch(`${baseUrl}/api/conspects`, {
      headers: { Authorization: `Bearer ${userToken}` }
    });
    assert.equal(conspects.status, 200);
    const conspectsPayload = await readJson(conspects);
    assert.equal(conspectsPayload.ok, true);
    assert.equal(conspectsPayload.items.length, 1);
    assert.equal(conspectsPayload.items[0].recordingId, fixtureRecordingId);
    assert.equal(conspectsPayload.items[0].htmlAvailable, true);
    assert.equal(conspectsPayload.items[0].markdownAvailable, true);

    const htmlResponse = await fetch(`${baseUrl}/api/conspects/${fixtureRecordingId}/html`, {
      headers: { Authorization: `Bearer ${userToken}` }
    });
    assert.equal(htmlResponse.status, 200);
    assert.match(String(htmlResponse.headers.get('content-type')), /text\/html/i);

    const mdResponse = await fetch(`${baseUrl}/api/conspects/${fixtureRecordingId}/md`, {
      headers: { Authorization: `Bearer ${userToken}` }
    });
    assert.equal(mdResponse.status, 200);
    assert.match(String(mdResponse.headers.get('content-type')), /text\/markdown/i);

    const invalidRecordingId = await fetch(`${baseUrl}/api/conspects/bad.id/html`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(invalidRecordingId.status, 400, childLog);
    const invalidRecordingPayload = await readJson(invalidRecordingId);
    assert.equal(invalidRecordingPayload.ok, false);
    assert.equal(invalidRecordingPayload.error.code, 'INVALID_RECORDING_ID');

    const notionBadId = await fetch(`${baseUrl}/api/admin/notion-writeback`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        recordingId: 'bad.id',
        pageTitle: 'Экклесиология'
      })
    });
    assert.equal(notionBadId.status, 400, childLog);
    const notionBadIdPayload = await readJson(notionBadId);
    assert.equal(notionBadIdPayload.ok, false);
    assert.equal(notionBadIdPayload.error.code, 'INVALID_RECORDING_ID');
  }
);
