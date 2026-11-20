const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const http = require('http');
const { once } = require('events');
const { createDb } = require('../src/db');
const { createApp } = require('../src/app');
const { parseSignedRequest } = require('../src/routes/legal');

function makeSignedRequest(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${sig}.${body}`;
}

async function withServer(t, fn) {
  const db = await createDb(':memory:');
  const config = {
    mockMode: true,
    appUrl: 'http://127.0.0.1',
    sessionSecret: 'test-secret',
    sessionTtlDays: 30,
    authMode: 'facebook',
    meta: { apiVersion: 'v23.0', appId: '123', appSecret: 'test-secret-meta', scopes: [] },
  };
  const app = createApp({ db, config, instagram: {}, engine: {} });
  const server = http.createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  try {
    await fn({ db, config, port });
  } finally {
    server.close();
    await db.close();
  }
}

test('privacy, terms, and data-deletion pages are public', async () => {
  await withServer(null, async ({ port }) => {
    for (const path of ['/privacy', '/data-deletion', '/terms']) {
      const res = await fetch(`http://127.0.0.1:${port}${path}`);
      assert.equal(res.status, 200);
      const html = await res.text();
      assert.match(html, /Rona DM Manager/);
    }
    const privacy = await (await fetch(`http://127.0.0.1:${port}/privacy`)).text();
    assert.match(privacy, /Privacy Policy/);
    assert.match(privacy, /מדיניות פרטיות/);
    const deletion = await (await fetch(`http://127.0.0.1:${port}/data-deletion`)).text();
    assert.match(deletion, /Data deletion|Data Deletion/i);
    assert.match(deletion, /מחיקת נתונים/);
  });
});

test('data-deletion callback verifies signed_request and returns a status URL', async () => {
  await withServer(null, async ({ db, config, port }) => {
    const missing = await fetch(`http://127.0.0.1:${port}/data-deletion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(missing.status, 400);

    const signed = makeSignedRequest({ algorithm: 'HMAC-SHA256', user_id: 'fb_99' }, config.meta.appSecret);
    assert.equal(parseSignedRequest(signed, config.meta.appSecret).user_id, 'fb_99');
    const ok = await fetch(`http://127.0.0.1:${port}/data-deletion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signed_request: signed }),
    });
    assert.equal(ok.status, 200);
    const json = await ok.json();
    assert.ok(json.confirmation_code);
    assert.match(json.url, /data-deletion\/status/);
    const row = await db.getDeletionRequest(json.confirmation_code);
    assert.ok(row);
    const status = await fetch(json.url.replace(config.appUrl, `http://127.0.0.1:${port}`));
    assert.equal(status.status, 200);
    assert.match(await status.text(), /Status/);
  });
});
