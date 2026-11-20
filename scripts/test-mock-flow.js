#!/usr/bin/env node
/**
 * End-to-end mock flow against a live HTTP server:
 * login → create automation → fake comment webhook → public reply + opening DM
 * → button postback → second DM with tracked link → click → metrics.
 */
const http = require('http');
const { once } = require('events');
const path = require('path');
const os = require('os');
const fs = require('fs');

process.env.MOCK_MODE = 'true';
process.env.SESSION_SECRET = 'test-secret';
process.env.PORT = process.env.PORT || '0';
process.env.DB_PATH = path.join(os.tmpdir(), `rona-insta-flow-${Date.now()}.db`);
process.env.APP_URL = 'http://127.0.0.1';

const { createDb } = require('../src/db');
const { createInstagramClient } = require('../src/services/instagram');
const { createEngine } = require('../src/services/engine');
const { createApp } = require('../src/app');
const config = require('../src/config');

function fail(msg) {
  console.error('FAIL:', msg);
  process.exitCode = 1;
}

async function main() {
  config.mockMode = true;
  config.dbPath = process.env.DB_PATH;
  const db = await createDb(config.dbPath);
  const instagram = createInstagramClient({ config, db });
  const engine = createEngine({ db, instagram, config });
  const app = createApp({ db, config, instagram, engine });
  const server = http.createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  config.appUrl = base;
  console.log('Server on', base);

  const jar = new Map();
  function cookieHeader() {
    return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }
  function storeCookies(res) {
    const raw = res.headers.getSetCookie?.() || res.headers.get('set-cookie');
    const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
    for (const c of list) {
      const [nv] = c.split(';');
      const eq = nv.indexOf('=');
      jar.set(nv.slice(0, eq).trim(), nv.slice(eq + 1));
    }
  }
  async function req(method, url, body) {
    const res = await fetch(base + url, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        Cookie: cookieHeader(),
        'X-Mock-Webhook': '1',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      redirect: 'manual',
    });
    storeCookies(res);
    const text = await res.text();
    let json;
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    return { res, json, status: res.status };
  }

  // 1. Health + login page
  const health = await req('GET', '/api/health');
  if (!health.json?.ok || !health.json.mockMode) fail('health check failed: ' + JSON.stringify(health.json));
  else console.log('✓ health (mock mode)');
  const healthRoot = await req('GET', '/health');
  if (!healthRoot.json?.ok) fail('GET /health failed: ' + JSON.stringify(healthRoot.json));
  else console.log('✓ GET /health');

  const home = await req('GET', '/');
  if (home.status !== 200 || !String(home.json).includes('אוטומציות')) fail('UI did not load');
  else console.log('✓ UI HTML loads');

  // 2. Mock login
  const login = await req('POST', '/auth/mock-login', { username: 'rona_demo' });
  if (!login.json?.ok) fail('mock login failed');
  else console.log('✓ mock login as @rona_demo');

  const me = await req('GET', '/auth/me');
  if (me.json?.account?.username !== 'rona_demo') fail('auth/me mismatch');
  else console.log('✓ session scoped to @rona_demo');

  // 3. Seeded automation exists
  let autos = await req('GET', '/api/automations');
  if (!autos.json.automations?.length) fail('expected seeded automation');
  else console.log('✓ seeded automation present:', autos.json.automations[0].name);

  // 4. Create a second automation (any post, contains)
  const created = await req('POST', '/api/automations', {
    name: 'בדיקת זרימה',
    status: 'live',
    trigger_scope: 'any',
    keyword_mode: 'keywords',
    keywords: 'שולחת, לינק',
    match_type: 'contains',
    public_reply_enabled: true,
    public_reply_variants: ['איזה כיף! שלחתי לך הודעה בפרטי ❤️'],
    opening_dm_enabled: true,
    opening_dm_text: 'היי! רוצה את הלינק?',
    opening_dm_button_label: 'כן, אשמח ❤️',
    second_dm_text: 'הנה הלינק 👇',
    second_dm_link_url: 'https://example.com/recipe',
    second_dm_link_title: 'למתכון',
    followup_enabled: true,
    followup_hours: 24,
    followup_text: 'רק מוודאת שקיבלת 💕',
  });
  if (created.status !== 201) fail('create automation failed ' + JSON.stringify(created.json));
  const auto = created.json.automation;
  console.log('✓ created live automation', auto.id);

  // 5. Fake comment via API (and also via raw webhook)
  const comment = await req('POST', '/api/mock/comment', {
    text: 'אפשר לינק בבקשה',
    username: 'maya',
    media_id: 'mock_media_reel_morning',
    is_follower: true,
  });
  const result = comment.json?.results?.[0];
  if (!result?.ok || !result.publicReply || !result.opening) {
    fail('comment did not trigger expected sends: ' + JSON.stringify(comment.json, null, 2));
  } else {
    console.log('✓ comment triggered public reply + opening DM');
    console.log('  public:', result.publicReply);
  }

  // 6. Webhook signature path still accepts mock header
  const webhook = await req('POST', '/webhook', {
    object: 'instagram',
    entry: [{ id: me.json.account.ig_user_id, time: Date.now(), changes: [] }],
  });
  if (webhook.status !== 200) fail('webhook did not ACK');
  else console.log('✓ webhook ACK');

  // 7. Button press → second DM
  const pb = await req('POST', '/api/mock/postback', {
    sender_id: (await db.getRecipient(result.recipientId)).igsid,
    payload: `QR_YES:${result.automationId}:${result.recipientId}`,
    title: 'כן, אשמח ❤️',
  });
  if (!pb.json?.results?.[0]?.ok) fail('postback failed: ' + JSON.stringify(pb.json));
  else console.log('✓ postback sent second DM + link button');

  const rec = await db.getRecipient(result.recipientId);
  if (!rec.second_sent_at || !rec.click_id) fail('recipient missing second DM state');

  // 8. Click tracking
  const click = await fetch(base + '/r/' + rec.click_id, { redirect: 'manual' });
  if (click.status !== 302 || !String(click.headers.get('location')).includes('example.com/recipe')) {
    fail('redirect missing, status=' + click.status);
  } else console.log('✓ click redirect to destination');
  const after = await db.getRecipient(rec.id);
  if (!after.clicked_at) fail('click was not recorded');
  else console.log('✓ click recorded');

  const recList = await req('GET', `/api/automations/${auto.id}/recipients`);
  if (recList.json.metrics.total_clicks < 1 || recList.json.metrics.total_sends < 1) {
    fail('metrics not updated: ' + JSON.stringify(recList.json.metrics));
  } else console.log('✓ metrics', recList.json.metrics);

  // 9. Follow-up should NOT send after click
  const fu = await req('POST', '/api/mock/followups', { recipient_id: rec.id, force_due: true });
  const mine = (fu.json.results || []).filter((r) => r.recipientId === rec.id);
  if (mine.length) fail('follow-up should not send after click');
  else console.log('✓ follow-up skipped after click');

  // 10. Second user cannot see first account automations (isolation via session)
  jar.clear();
  await req('POST', '/auth/mock-login', { username: 'other_user' });
  const otherAutos = await req('GET', '/api/automations');
  if (otherAutos.json.automations.some((a) => a.id === auto.id)) fail('account isolation broken');
  else console.log('✓ automations are scoped per account');

  server.close();
  await db.close();
  try { fs.unlinkSync(process.env.DB_PATH); } catch {}
  if (process.exitCode) {
    console.error('Mock flow finished with failures.');
    process.exit(1);
  }
  console.log('\nAll mock flow checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
