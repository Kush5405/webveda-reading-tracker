'use strict';

const { spawn } = require('child_process');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 3100 + Math.floor(Math.random() * 500);
const BASE = `http://localhost:${PORT}`;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webveda-'));
const DB_PATH = path.join(tmpDir, 'nested', 'test.db'); // also tests auto-create of parent folder

let child;

async function startServer() {
  child = spawn(process.execPath, [path.join(__dirname, 'index.js')], {
    env: { ...process.env, PORT: String(PORT), DB_PATH },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return;
    } catch (_) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Server did not start');
}

function stopServer() {
  return new Promise((resolve) => {
    if (!child) return resolve();
    child.once('exit', resolve);
    child.kill();
  });
}

const json = (method, url, body) =>
  fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

async function main() {
  await startServer();
  console.log('Running API tests...');

  await test('health check', async () => {
    const r = await fetch(`${BASE}/api/health`);
    assert.strictEqual(r.status, 200);
  });

  await test('GET /api/books returns 3 + 3 seeded unread books with boolean read', async () => {
    const data = await (await fetch(`${BASE}/api/books`)).json();
    assert.strictEqual(data.fiction.length, 3);
    assert.strictEqual(data.nonfiction.length, 3);
    for (const b of [...data.fiction, ...data.nonfiction]) assert.strictEqual(b.read, false);
    assert.strictEqual(data.fiction[0].id, 'fic-1');
    assert.strictEqual(data.nonfiction[2].id, 'nonfic-3');
  });

  await test('PATCH valid update (true) persists', async () => {
    const r = await json('PATCH', '/api/books/fic-1', { read: true });
    assert.strictEqual(r.status, 200);
    const data = await (await fetch(`${BASE}/api/books`)).json();
    assert.strictEqual(data.fiction.find((b) => b.id === 'fic-1').read, true);
  });

  await test('PATCH idempotent (true twice -> 200 both times)', async () => {
    const a = await json('PATCH', '/api/books/nonfic-2', { read: true });
    const b = await json('PATCH', '/api/books/nonfic-2', { read: true });
    assert.strictEqual(a.status, 200);
    assert.strictEqual(b.status, 200);
    assert.strictEqual((await b.json()).read, true);
  });

  await test('PATCH back to false works', async () => {
    const r = await json('PATCH', '/api/books/fic-1', { read: false });
    assert.strictEqual(r.status, 200);
    assert.strictEqual((await r.json()).read, false);
  });

  await test('PATCH unknown id -> 404', async () => {
    const r = await json('PATCH', '/api/books/does-not-exist', { read: true });
    assert.strictEqual(r.status, 404);
  });

  await test('PATCH rejects non-boolean read with 400', async () => {
    for (const bad of ['true', 1, 0, null]) {
      const r = await json('PATCH', '/api/books/fic-2', { read: bad });
      assert.strictEqual(r.status, 400, `expected 400 for ${JSON.stringify(bad)}`);
    }
    const missing = await json('PATCH', '/api/books/fic-2', {});
    assert.strictEqual(missing.status, 400);
  });

  await test('rejected PATCH did not change data', async () => {
    const data = await (await fetch(`${BASE}/api/books`)).json();
    assert.strictEqual(data.fiction.find((b) => b.id === 'fic-2').read, false);
  });

  await test('GET video-progress defaults to 0', async () => {
    const data = await (await fetch(`${BASE}/api/video-progress`)).json();
    assert.deepStrictEqual(data, { timestamp: 0 });
  });

  await test('PUT video-progress saves and returns timestamp', async () => {
    const r = await json('PUT', '/api/video-progress', { timestamp: 123.45 });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(await r.json(), { timestamp: 123.45 });
    const g = await (await fetch(`${BASE}/api/video-progress`)).json();
    assert.deepStrictEqual(g, { timestamp: 123.45 });
  });

  await test('PUT video-progress rejects invalid values', async () => {
    for (const bad of ['10', -1, null, {}]) {
      const r = await json('PUT', '/api/video-progress', { timestamp: bad });
      assert.strictEqual(r.status, 400, `expected 400 for ${JSON.stringify(bad)}`);
    }
    // NaN/Infinity serialize to null in JSON -> also rejected
    const r = await json('PUT', '/api/video-progress', { timestamp: Infinity });
    assert.strictEqual(r.status, 400);
    const none = await json('PUT', '/api/video-progress', {});
    assert.strictEqual(none.status, 400);
  });

  await test('data persists across server restart (and no re-seed overwrite)', async () => {
    await json('PATCH', '/api/books/fic-3', { read: true });
    await stopServer();
    await startServer();
    const progress = await (await fetch(`${BASE}/api/video-progress`)).json();
    assert.deepStrictEqual(progress, { timestamp: 123.45 });
    const books = await (await fetch(`${BASE}/api/books`)).json();
    assert.strictEqual(books.fiction.find((b) => b.id === 'fic-3').read, true);
    assert.strictEqual(books.fiction.length + books.nonfiction.length, 6);
  });

  console.log(`\nAll ${passed} tests passed.`);
}

main()
  .catch((err) => {
    console.error('\nTEST FAILED:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await stopServer();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
