const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { createDb } = require('../src/db');
const { createInstagramClient } = require('../src/services/instagram');
const { createEngine } = require('../src/services/engine');
const { seedDemoAutomation } = require('../src/services/seed');
const { processPayload, mockCommentPayload, mockPostbackPayload } = require('../src/routes/webhooks');

async function setup() {
  const db = await createDb(':memory:');
  const config = {
    mockMode: true,
    appUrl: 'http://localhost:3000',
    followCheckMode: 'stub',
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
  const auto = await seedDemoAutomation(db, account.id);
  return { db, config, instagram, engine, account, auto };
}

describe('comment automation engine', () => {
  test('matching comment sends public reply and opening private reply with quick reply', async () => {
    const { db, engine, account, auto, config } = await setup();
    const payload = mockCommentPayload({
      igUserId: account.ig_user_id,
      commentId: 'c_1',
      text: 'הכנה',
      mediaId: auto.media_id,
      fromId: 'igsid_dana',
      fromUsername: 'dana',
      isFollower: true,
    });
    const results = await processPayload(payload, { db, engine });
    assert.equal(results[0].ok, true);
    assert.ok(results[0].publicReply);
    assert.match(results[0].publicReply, /פרטי|💌|❤️/);
    assert.ok(results[0].opening.message_id);
    const logs = await db.listOutbound({ accountId: account.id, limit: 20 });
    const types = logs.map((l) => l.type);
    assert.ok(types.includes('comment_reply'));
    assert.ok(types.includes('private_reply'));
    const recs = await db.listRecipients(auto.id);
    assert.equal(recs.length, 1);
    assert.equal(recs[0].status, 'opening_sent');
    const metrics = await db.getAutomationMetrics(auto.id);
    assert.equal(metrics.total_sends, 1);
  });

  test('duplicate comment is ignored', async () => {
    const { db, engine, account, auto } = await setup();
    const make = () =>
      mockCommentPayload({
        igUserId: account.ig_user_id,
        commentId: 'c_dup',
        text: 'הכנה',
        mediaId: auto.media_id,
        fromId: 'igsid_x',
        fromUsername: 'x',
      });
    await processPayload(make(), { db, engine });
    const second = await processPayload(make(), { db, engine });
    assert.equal(second[0].skipped, true);
    assert.ok(['duplicate', 'already_recipient'].includes(second[0].reason), second[0].reason);
    assert.equal((await db.listRecipients(auto.id)).length, 1);
  });

  test('non-matching keyword is skipped', async () => {
    const { db, engine, account, auto } = await setup();
    const results = await processPayload(
      mockCommentPayload({
        igUserId: account.ig_user_id,
        commentId: 'c_nomatch',
        text: 'יפה מאוד',
        mediaId: auto.media_id,
        fromId: 'igsid_y',
        fromUsername: 'y',
      }),
      { db, engine }
    );
    assert.equal(results[0].reason, 'no_match');
    assert.equal((await db.listRecipients(auto.id)).length, 0);
  });

  test('must-follow skips DM when the commenter is not a follower', async () => {
    const { db, engine, account, auto } = await setup();
    await db.updateAutomation(auto.id, { must_follow: 1 });
    const results = await processPayload(
      mockCommentPayload({
        igUserId: account.ig_user_id,
        commentId: 'c_unfollow',
        text: 'הכנה',
        mediaId: auto.media_id,
        fromId: 'igsid_z',
        fromUsername: 'z',
        isFollower: false,
      }),
      { db, engine }
    );
    assert.equal(results[0].reason, 'not_follower');
    const recs = await db.listRecipients(auto.id);
    assert.equal(recs[0].status, 'skipped_not_follower');
    const types = (await db.listOutbound({ accountId: account.id, limit: 20 })).map((l) => l.type);
    assert.ok(types.includes('comment_reply'));
    assert.ok(!types.includes('private_reply'));
  });

  test('quick-reply postback sends second DM with tracked link button', async () => {
    const { db, engine, account, auto } = await setup();
    const first = await processPayload(
      mockCommentPayload({
        igUserId: account.ig_user_id,
        commentId: 'c_btn',
        text: 'מתכון',
        mediaId: auto.media_id,
        fromId: 'igsid_btn',
        fromUsername: 'btnuser',
      }),
      { db, engine }
    );
    const recipientId = first[0].recipientId;
    const rec = await db.getRecipient(recipientId);
    const pb = await processPayload(
      mockPostbackPayload({
        igUserId: account.ig_user_id,
        senderId: rec.igsid,
        payload: `QR_YES:${auto.id}:${recipientId}`,
        title: 'כן, אשמח ❤️',
      }),
      { db, engine }
    );
    assert.equal(pb[0].ok, true);
    const after = await db.getRecipient(recipientId);
    assert.equal(after.status, 'second_sent');
    assert.ok(after.second_sent_at);
    const logs = await db.listOutbound({ accountId: account.id, limit: 30 });
    assert.ok(logs.some((l) => l.type === 'dm_template' && l.payload.includes(`/r/${after.click_id}`)));
  });

  test('click redirect records a click and follow-up is not sent afterwards', async () => {
    const { db, engine, account, auto, config } = await setup();
    const first = await processPayload(
      mockCommentPayload({
        igUserId: account.ig_user_id,
        commentId: 'c_click',
        text: 'הכנה',
        mediaId: auto.media_id,
        fromId: 'igsid_click',
        fromUsername: 'clicker',
      }),
      { db, engine }
    );
    const rec = await db.getRecipient(first[0].recipientId);
    await engine.handlePostback(account, {
      sender: { id: rec.igsid },
      postback: { payload: `QR_YES:${auto.id}:${rec.id}`, title: 'כן' },
    });
    const mid = await db.getRecipient(rec.id);
    await db.updateRecipient(mid.id, { clicked_at: '2026-11-20 12:00:00', status: 'clicked' });
    // Backdate so follow-up would be due if not clicked
    await db.updateRecipient(mid.id, {
      second_sent_at: '2026-11-18 12:00:00',
      last_user_interaction_at: '2026-11-20 11:00:00',
    });
    const results = await engine.processFollowups();
    assert.ok(!results.some((r) => r.recipientId === mid.id));
    const metrics = await db.getAutomationMetrics(auto.id);
    assert.equal(metrics.total_clicks, 1);
  });

  test('follow-up is sent when the link was not clicked, still inside 24h window', async () => {
    const { db, engine, account, auto } = await setup();
    await db.updateAutomation(auto.id, { followup_hours: 1 });
    const first = await processPayload(
      mockCommentPayload({
        igUserId: account.ig_user_id,
        commentId: 'c_fu',
        text: 'הכנה',
        mediaId: auto.media_id,
        fromId: 'igsid_fu',
        fromUsername: 'fu',
      }),
      { db, engine }
    );
    const rec = await db.getRecipient(first[0].recipientId);
    await engine.handlePostback(account, {
      sender: { id: rec.igsid },
      postback: { payload: `QR_YES:${auto.id}:${rec.id}`, title: 'כן' },
    });
    const sqlNow = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
    const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000).toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
    await db.updateRecipient(rec.id, {
      second_sent_at: twoHoursAgo,
      last_user_interaction_at: sqlNow,
      clicked_at: null,
      followup_sent_at: null,
      status: 'second_sent',
    });
    const results = await engine.processFollowups();
    assert.ok(results.some((r) => r.ok && r.recipientId === rec.id));
    assert.equal((await db.getRecipient(rec.id)).status, 'followup_sent');
  });

  test('next-post automations bind to a newly published media item', async () => {
    const { db, engine, account } = await setup();
    const auto = await db.createAutomation({
      account_id: account.id,
      name: 'הפוסט הבא',
      status: 'live',
      trigger_scope: 'next',
      next_pending: 1,
      keyword_mode: 'any',
      opening_dm_enabled: 1,
      opening_dm_text: 'היי',
      public_reply_enabled: 0,
    });
    const existing = [
      { id: 'old_1', caption: 'ישן', timestamp: '2026-11-01T10:00:00+0000', permalink: 'https://ig/p/old' },
    ];
    await engine.bindNewMedia(account, existing);
    const published = [
      { id: 'new_99', caption: 'חדש', timestamp: '2026-11-20T10:00:00+0000', permalink: 'https://ig/p/new' },
      ...existing,
    ];
    const bind = await engine.bindNewMedia(account, published);
    assert.equal(bind.bound, 1);
    const updated = await db.getAutomation(auto.id);
    assert.equal(updated.media_id, 'new_99');
    assert.equal(updated.next_pending, 0);
  });

  test('automations are scoped per account', async () => {
    const { db, engine, account, auto } = await setup();
    const user2 = await db.createUser();
    const other = await db.upsertAccount({
      userId: user2,
      igUserId: 'someone_else',
      username: 'other',
      accessToken: 't',
    });
    const results = await processPayload(
      mockCommentPayload({
        igUserId: other.ig_user_id,
        commentId: 'c_other',
        text: 'הכנה',
        mediaId: auto.media_id,
        fromId: 'igsid_o',
        fromUsername: 'o',
      }),
      { db, engine }
    );
    assert.equal(results[0].reason, 'no_match');
    assert.equal((await db.listRecipients(auto.id)).length, 0);
    assert.equal((await db.listAutomations(other.id)).length, 0);
    assert.ok((await db.listAutomations(account.id)).length >= 1);
  });
});
