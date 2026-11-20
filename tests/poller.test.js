const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { once } = require('events');
const { createDb } = require('../src/db');
const { createInstagramClient } = require('../src/services/instagram');
const { createEngine } = require('../src/services/engine');
const { createApp } = require('../src/app');
const { pollComments, classifyNeed, isPollerEnabled } = require('../src/services/commentPoller');
const { processPayload, mockCommentPayload } = require('../src/routes/webhooks');
const { sendManualOpeningDm, sendMissingPublicReply, attachRecipientFlags } = require('../src/services/commentAudit');

const OPENING_TEXT = 'היי! שמחה שאהבת 😊 רוצה שאשלח לך את הפרטים?';
const NOW = new Date('2026-11-20T13:50:00Z');

async function setup(overrides = {}) {
  const db = await createDb(':memory:');
  const config = {
    mockMode: true,
    appUrl: 'http://localhost:3000',
    followCheckMode: 'stub',
    sessionSecret: 'test-secret',
    sessionTtlDays: 30,
    authMode: 'facebook',
    commentPollIntervalMs: 60000,
    meta: { apiVersion: 'v23.0', appId: '', appSecret: '', scopes: [] },
  };
  const instagram = createInstagramClient({ config, db });
  const engine = createEngine({ db, instagram, config });
  const userId = await db.createUser();
  const account = await db.upsertAccount({
    userId,
    igUserId: 'mock_ig_rona_demo',
    username: 'rona_demo',
    name: 'רונה',
    accessToken: 'mock-token',
    accountType: 'MEDIA_CREATOR',
  });
  const auto = await db.createAutomation({
    account_id: account.id,
    name: 'הכנה',
    status: 'live',
    trigger_scope: 'specific',
    media_id: overrides.mediaId || 'mock_media_hakana',
    keyword_mode: 'keywords',
    keywords: 'הכנה',
    match_type: 'whole_word',
    public_reply_enabled: 1,
    public_reply_variants: JSON.stringify(['שלחתי לך בפרטי ❤️']),
    opening_dm_enabled: 1,
    opening_dm_text: OPENING_TEXT,
    opening_dm_button_label: 'כן, אשמח ❤️',
  });
  return { db, config, instagram, engine, account, auto };
}

function outboundTypes(logs) {
  return logs.map((l) => l.type);
}

describe('comment poller and shared dedupe', () => {
  test('comment_poller_enabled defaults on and can be toggled off', async () => {
    const { db, account } = await setup();
    const fresh = await db.getAccount(account.id);
    assert.equal(Number(fresh.comment_poller_enabled), 1);
    assert.equal(isPollerEnabled(fresh), true);
    const updated = await db.updateAccountSettings(account.id, { comment_poller_enabled: false });
    assert.equal(Number(updated.comment_poller_enabled), 0);
    assert.equal(isPollerEnabled(updated), false);
    await db.close();
  });

  test('poller sends public reply + DM for a need_message comment and logs it', async () => {
    const { db, instagram, engine, config, account, auto } = await setup();
    const results = await pollComments({ db, instagram, engine, config, now: NOW });
    const tamar = results.find((r) => r.commentId === 'mock_c_tamar');
    assert.ok(tamar);
    assert.equal(tamar.ok, true);
    assert.ok(tamar.publicReply);
    assert.ok(tamar.opening && tamar.opening.message_id);

    const recs = await db.listRecipients(auto.id);
    assert.equal(recs.length, 1);
    assert.equal(recs[0].comment_id, 'mock_c_tamar');
    assert.ok(recs[0].dm_sent_at);
    assert.ok(recs[0].public_reply_sent_at);
    assert.equal(await db.hasPublicReply('mock_c_tamar'), true);

    const logs = await db.listOutbound({ accountId: account.id, limit: 30 });
    const types = outboundTypes(logs);
    assert.ok(types.includes('comment_reply'));
    assert.ok(types.includes('private_reply'));
    assert.ok(types.includes('poller_send'));

    // dana already has a public reply from Rona and no app-recorded DM — do not double-DM
    assert.equal(recs.some((r) => r.comment_id === 'mock_c_dana' || r.username === 'dana_got_auto'), false);
    // shira is older than 7 days
    assert.equal(recs.some((r) => r.comment_id === 'mock_c_shira'), false);
    await db.close();
  });

  test('webhook then poller does not send twice (shared dedupe)', async () => {
    const { db, instagram, engine, config, account, auto } = await setup();
    const first = await processPayload(
      mockCommentPayload({
        igUserId: account.ig_user_id,
        commentId: 'mock_c_tamar',
        text: 'הכנה',
        mediaId: auto.media_id,
        fromId: 'id_tamar',
        fromUsername: 'tamar_eligible',
      }),
      { db, engine }
    );
    assert.equal(first[0].ok, true);

    const afterHook = await db.listOutbound({ accountId: account.id, limit: 40 });
    const hookPrivates = afterHook.filter((l) => l.type === 'private_reply').length;
    const hookReplies = afterHook.filter((l) => l.type === 'comment_reply').length;

    const results = await pollComments({ db, instagram, engine, config, now: NOW });
    const tamar = results.find((r) => r.commentId === 'mock_c_tamar');
    assert.ok(!tamar || tamar.skipped || tamar.reason === 'already_recipient');
    assert.equal((await db.listRecipients(auto.id)).length, 1);
    const afterPoll = await db.listOutbound({ accountId: account.id, limit: 40 });
    assert.equal(afterPoll.filter((l) => l.type === 'private_reply').length, hookPrivates);
    assert.equal(afterPoll.filter((l) => l.type === 'comment_reply').length, hookReplies);
    await db.close();
  });

  test('poller then webhook does not send twice (shared dedupe)', async () => {
    const { db, instagram, engine, config, account, auto } = await setup();
    await pollComments({ db, instagram, engine, config, now: NOW });
    assert.equal((await db.listRecipients(auto.id)).length, 1);

    const hooked = await processPayload(
      mockCommentPayload({
        igUserId: account.ig_user_id,
        commentId: 'mock_c_tamar',
        text: 'הכנה',
        mediaId: auto.media_id,
        fromId: 'id_tamar',
        fromUsername: 'tamar_eligible',
      }),
      { db, engine }
    );
    assert.equal(hooked[0].skipped, true);
    assert.equal(hooked[0].reason, 'already_recipient');
    assert.equal((await db.listRecipients(auto.id)).length, 1);
    const logs = await db.listOutbound({ accountId: account.id, limit: 40 });
    assert.equal(logs.filter((l) => l.type === 'private_reply').length, 1);
    assert.equal(logs.filter((l) => l.type === 'comment_reply').length, 1);
    await db.close();
  });

  test('concurrent webhook and poller insert a single recipient', async () => {
    const { db, instagram, engine, config, account, auto } = await setup();
    const payload = mockCommentPayload({
      igUserId: account.ig_user_id,
      commentId: 'mock_c_tamar',
      text: 'הכנה',
      mediaId: auto.media_id,
      fromId: 'id_tamar',
      fromUsername: 'tamar_eligible',
    });
    await Promise.all([
      processPayload(payload, { db, engine }),
      pollComments({ db, instagram, engine, config, now: NOW }),
    ]);
    assert.equal((await db.listRecipients(auto.id)).length, 1);
    const logs = await db.listOutbound({ accountId: account.id, limit: 40 });
    assert.equal(logs.filter((l) => l.type === 'private_reply').length, 1);
    await db.close();
  });

  test('poller posts a missing public reply when the DM was already sent', async () => {
    const { db, instagram, engine, config, account, auto } = await setup();
    await db.createRecipient({
      automation_id: auto.id,
      account_id: account.id,
      comment_id: 'mock_c_tamar',
      igsid: 'id_tamar',
      username: 'tamar_eligible',
      comment_text: 'הכנה',
      media_id: auto.media_id,
      status: 'opening_sent',
      opening_sent_at: '2026-11-19 20:05:00',
      dm_sent_at: '2026-11-19 20:05:00',
    });
    await db.recordPrivateReply({
      commentId: 'mock_c_tamar',
      accountId: account.id,
      recipientIgsid: 'id_tamar',
      messageId: 'mid_existing',
    });

    const results = await pollComments({ db, instagram, engine, config, now: NOW });
    const tamar = results.find((r) => r.commentId === 'mock_c_tamar');
    assert.ok(tamar);
    assert.equal(await db.hasPublicReply('mock_c_tamar'), true);
    assert.equal((await db.listRecipients(auto.id)).length, 1);
    const logs = await db.listOutbound({ accountId: account.id, limit: 40 });
    assert.ok(logs.some((l) => l.type === 'comment_reply'));
    assert.equal(logs.filter((l) => l.type === 'private_reply').length, 0);
    await db.close();
  });

  test('poller sends a missing DM when the app already posted the public reply', async () => {
    const { db, instagram, engine, config, account, auto } = await setup();
    await db.recordObservedPublicReply({
      commentId: 'mock_c_tamar',
      accountId: account.id,
      source: 'app',
    });
    const results = await pollComments({ db, instagram, engine, config, now: NOW });
    const tamar = results.find((r) => r.commentId === 'mock_c_tamar');
    assert.ok(tamar);
    assert.equal(tamar.ok, true);
    assert.equal((await db.listRecipients(auto.id)).length, 1);
    const rec = (await db.listRecipients(auto.id))[0];
    assert.ok(rec.dm_sent_at);
    const logs = await db.listOutbound({ accountId: account.id, limit: 40 });
    assert.equal(logs.filter((l) => l.type === 'private_reply').length, 1);
    await db.close();
  });

  test('failed send is retried once and then stops', async () => {
    const { db, instagram, engine, config, account, auto } = await setup();
    const orig = instagram.sendPrivateReply.bind(instagram);
    let calls = 0;
    instagram.sendPrivateReply = async (...args) => {
      calls += 1;
      throw new Error('send_boom');
    };
    await pollComments({ db, instagram, engine, config, now: NOW });
    const rec1 = (await db.listRecipients(auto.id))[0];
    assert.ok(rec1);
    assert.equal(rec1.status, 'failed');
    assert.equal(Number(rec1.send_attempts), 1);

    await pollComments({ db, instagram, engine, config, now: NOW });
    const rec2 = (await db.listRecipients(auto.id))[0];
    assert.equal(rec2.status, 'failed');
    assert.equal(Number(rec2.send_attempts), 2);
    assert.equal(calls, 2);

    instagram.sendPrivateReply = orig;
    await pollComments({ db, instagram, engine, config, now: NOW });
    const rec3 = (await db.listRecipients(auto.id))[0];
    assert.equal(Number(rec3.send_attempts), 2);
    assert.equal(rec3.dm_sent_at, null);
    const logs = await db.listOutbound({ accountId: account.id, limit: 40 });
    assert.equal(logs.filter((l) => l.type === 'private_reply').length, 0);
    await db.close();
  });

  test('disabled account toggle skips the poller', async () => {
    const { db, instagram, engine, config, account, auto } = await setup();
    await db.updateAccountSettings(account.id, { comment_poller_enabled: false });
    const results = await pollComments({ db, instagram, engine, config, now: NOW });
    assert.ok(results.some((r) => r.reason === 'poller_disabled'));
    assert.equal((await db.listRecipients(auto.id)).length, 0);
    await db.close();
  });

  test('unique recipient claim prevents a second row for the same comment or user', async () => {
    const { db, auto, account } = await setup();
    const first = await db.claimRecipient({
      automation_id: auto.id,
      account_id: account.id,
      comment_id: 'c_unique',
      igsid: 'ig_unique',
      username: 'unique_user',
      status: 'pending',
    });
    assert.equal(first.claimed, true);
    const sameComment = await db.claimRecipient({
      automation_id: auto.id,
      account_id: account.id,
      comment_id: 'c_unique',
      igsid: 'ig_other',
      username: 'other',
      status: 'pending',
    });
    assert.equal(sameComment.claimed, false);
    const sameUser = await db.claimRecipient({
      automation_id: auto.id,
      account_id: account.id,
      comment_id: 'c_other',
      igsid: 'ig_unique',
      username: 'unique_user',
      status: 'pending',
    });
    assert.equal(sameUser.claimed, false);
    assert.equal((await db.listRecipients(auto.id)).length, 1);
    await db.close();
  });

  test('manual missing public-reply endpoint fills only the public reply', async () => {
    const { db, instagram, engine, account, auto } = await setup();
    await db.createRecipient({
      automation_id: auto.id,
      account_id: account.id,
      comment_id: 'mock_c_tamar',
      igsid: 'id_tamar',
      username: 'tamar_eligible',
      comment_text: 'הכנה',
      media_id: auto.media_id,
      status: 'opening_sent',
      opening_sent_at: '2026-11-19 20:05:00',
      dm_sent_at: '2026-11-19 20:05:00',
    });
    const result = await sendMissingPublicReply({
      db,
      instagram,
      engine,
      account,
      commentId: 'mock_c_tamar',
      mediaId: auto.media_id,
      now: NOW,
    });
    assert.equal(result.ok, true);
    assert.equal(await db.hasPublicReply('mock_c_tamar'), true);
    const logs = await db.listOutbound({ accountId: account.id, limit: 20 });
    assert.ok(logs.some((l) => l.type === 'comment_reply'));
    assert.equal(logs.filter((l) => l.type === 'private_reply').length, 0);
    const again = await sendMissingPublicReply({
      db,
      instagram,
      engine,
      account,
      commentId: 'mock_c_tamar',
      mediaId: auto.media_id,
      now: NOW,
    });
    assert.equal(again.ok, false);
    assert.equal(again.error, 'already_replied');
    await db.close();
  });

  test('PATCH /api/account/settings and public-reply route require auth and work when signed in', async () => {
    const { db, config, instagram, engine, account, auto } = await setup();
    const app = createApp({ db, config, instagram, engine });
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const { port } = server.address();
      const base = `http://127.0.0.1:${port}`;
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
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });
        storeCookies(res);
        return { status: res.status, json: await res.json().catch(() => ({})) };
      }

      const unauth = await req('PATCH', '/api/account/settings', { comment_poller_enabled: false });
      assert.equal(unauth.status, 401);

      const login = await req('POST', '/auth/mock-login', { username: 'rona_demo' });
      assert.equal(login.json.ok, true);

      const me = await req('GET', '/auth/me');
      assert.equal(me.json.account.comment_poller_enabled, true);

      const patched = await req('PATCH', '/api/account/settings', { comment_poller_enabled: false });
      assert.equal(patched.status, 200);
      assert.equal(patched.json.account.comment_poller_enabled, false);

      await db.createRecipient({
        automation_id: auto.id,
        account_id: account.id,
        comment_id: 'mock_c_tamar',
        igsid: 'id_tamar',
        username: 'tamar_eligible',
        comment_text: 'הכנה',
        media_id: auto.media_id,
        status: 'opening_sent',
        opening_sent_at: '2026-11-19 20:05:00',
        dm_sent_at: '2026-11-19 20:05:00',
      });
      const sent = await req('POST', '/api/audit/keyword-comments/mock_c_tamar/public-reply', {
        media_id: 'mock_media_hakana',
      });
      assert.equal(sent.status, 200);
      assert.equal(sent.json.ok, true);
      assert.equal(await db.hasPublicReply('mock_c_tamar'), true);
    } finally {
      server.close();
      await db.close();
    }
  });
});

test('poller cycle summary and send log lines are concise', async () => {
  const { pollComments, summarizePollerResults, formatPollerCycleLog, formatPollerSendLog } = require('../src/services/commentPoller');
  const { db, instagram, engine, config, account, auto } = await setup();
  const results = await pollComments({ db, instagram, engine, config, now: NOW });
  assert.equal(results.stats.accounts, 1);
  assert.equal(results.stats.enabled, 1);
  assert.ok(results.stats.automations >= 1);
  assert.ok(results.stats.comments >= 1);
  const summary = summarizePollerResults(results);
  assert.ok(summary.sent >= 1);
  const cycle = formatPollerCycleLog(summary);
  assert.match(cycle, /^\[comment-poller\] cycle /);
  assert.match(cycle, /accounts=1/);
  assert.match(cycle, /sent=/);
  const tamar = results.find((r) => r.commentId === 'mock_c_tamar');
  const line = formatPollerSendLog(tamar);
  assert.match(line, /^\[comment-poller\] send /);
  assert.match(line, /automation=הכנה/);
  assert.match(line, /user=@tamar_eligible/);
  assert.match(line, /public=ok/);
  assert.match(line, /dm=ok/);

  const logs = await db.listOutbound({ accountId: account.id, limit: 30 });
  const pollerLog = logs.find((l) => l.type === 'poller_send');
  assert.ok(pollerLog);
  assert.equal(pollerLog.automation_name, 'הכנה');
  assert.equal(pollerLog.recipient_username, 'tamar_eligible');
  await db.close();
});
