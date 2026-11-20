const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { once } = require('events');
const {
  matchesAuditKeyword,
  captionStartsWith,
  ageDays,
  isWithinPrivateReplyWindow,
  formatJerusalem,
  classifyDmStyle,
  looksCourseRelated,
  buildAudit,
  PRIVATE_REPLY_WINDOW_MS,
} = require('../src/lib/audit');
const { createDb } = require('../src/db');
const { createInstagramClient } = require('../src/services/instagram');
const { createEngine } = require('../src/services/engine');
const { createApp } = require('../src/app');
const { sendManualOpeningDm, attachRecipientFlags } = require('../src/services/commentAudit');
const { processPayload, mockCommentPayload } = require('../src/routes/webhooks');

const ACCOUNT = { username: 'ronaazarya_midwife', ig_user_id: '17841401150112850' };
const NOW = new Date('2026-11-20T13:50:00Z');

test('matches הכנה with spacing, punctuation, and emoji variants', () => {
  assert.equal(matchesAuditKeyword('הכנה', 'הכנה'), true);
  assert.equal(matchesAuditKeyword('  הכנה  ', 'הכנה'), true);
  assert.equal(matchesAuditKeyword('הכנה!', 'הכנה'), true);
  assert.equal(matchesAuditKeyword('הכנה❤️', 'הכנה'), true);
  assert.equal(matchesAuditKeyword('❤️הכנה❤️', 'הכנה'), true);
  assert.equal(matchesAuditKeyword('״הכנה״', 'הכנה'), true);
  assert.equal(matchesAuditKeyword('"הכנה"', 'הכנה'), true);
  assert.equal(matchesAuditKeyword('הגיבי הכנה בבקשה', 'הכנה'), true);
  assert.equal(matchesAuditKeyword('ה  כנה', 'הכנה'), true);
  assert.equal(matchesAuditKeyword('ה כ נ ה', 'הכנה'), true);
  assert.equal(matchesAuditKeyword('שלום', 'הכנה'), false);
  assert.equal(matchesAuditKeyword('להכנה שלי', 'הכנה'), true);
  assert.equal(matchesAuditKeyword('הכנה לטיול', 'הכנה'), true);
});

test('caption prefix matches typographic quotes and a trailing heart', () => {
  const live = 'הגיבי ״הכנה״ ואשלח לך את כל הפרטים❤️';
  assert.equal(captionStartsWith(live, 'הגיבי "הכנה" ואשלח לך את כל הפרטים'), true);
  assert.equal(captionStartsWith(live, 'הגיבי ״הכנה״ ואשלח לך את כל הפרטים❤️'), true);
  assert.equal(captionStartsWith('פוסט אחר', 'הגיבי "הכנה" ואשלח לך את כל הפרטים'), false);
});

test('age and 7-day private-reply window use elapsed time', () => {
  const fresh = new Date(NOW.getTime() - 2 * 86400000).toISOString();
  const old = new Date(NOW.getTime() - 8 * 86400000).toISOString();
  const almost = new Date(NOW.getTime() - (PRIVATE_REPLY_WINDOW_MS - 1000)).toISOString();
  const expired = new Date(NOW.getTime() - PRIVATE_REPLY_WINDOW_MS).toISOString();
  assert.equal(ageDays(fresh, NOW), 2);
  assert.equal(ageDays(old, NOW), 8);
  assert.equal(isWithinPrivateReplyWindow(fresh, NOW), true);
  assert.equal(isWithinPrivateReplyWindow(almost, NOW), true);
  assert.equal(isWithinPrivateReplyWindow(old, NOW), false);
  assert.equal(isWithinPrivateReplyWindow(expired, NOW), false);
});

test('Jerusalem timestamp is labeled and offset from UTC', () => {
  const label = formatJerusalem('2026-11-20T12:00:00+0000');
  assert.match(label, /20\/11\/2026/);
  assert.match(label, /14:00:00/);
  assert.match(label, /Asia\/Jerusalem/);
});

test('DM style detects ManyChat/automation vs manual course details', () => {
  assert.equal(
    classifyDmStyle([{ message: 'היי! שמחה שאהבת 😊 רוצה שאשלח לך את הפרטים?', from: { username: 'ronaazarya_midwife' } }]),
    'automated'
  );
  assert.equal(
    classifyDmStyle([{ message: 'היי, זה ManyChat — כן, אשמח ❤️', from: { username: 'ronaazarya_midwife' } }]),
    'automated'
  );
  assert.equal(
    classifyDmStyle([
      {
        message:
          'היי דנה, לגבי ההכנה ללידה: המפגש בזום ביום ראשון, המחיר 350 ומעבירים בביט. אם מתאים תכתבי לי ואשלח קישור.',
        from: { username: 'ronaazarya_midwife' },
      },
    ]),
    'manual'
  );
});

test('course-related helper recognizes links and הכנה ללידה wording', () => {
  assert.equal(looksCourseRelated('הנה קישור להכנה ללידה https://example.com/course'), true);
  assert.equal(looksCourseRelated('שלום, מה נשמע?'), false);
});

function comment({ id, text, username, hoursAgo, replies = [], parent_id = null, fromId = null }) {
  return {
    id,
    text,
    username,
    parent_id,
    from: { username, id: fromId || `id_${username}` },
    timestamp: new Date(NOW.getTime() - hoursAgo * 3600000).toISOString(),
    replies,
  };
}

function convo(username, messages) {
  return {
    id: `c_${username}`,
    participants: { data: [{ username, id: `id_${username}` }, { username: ACCOUNT.username, id: ACCOUNT.ig_user_id }] },
    messages,
  };
}

test('buildAudit classifies DM / eligible / expired / borderline cases', () => {
  const comments = [
    comment({
      id: 'c1',
      text: 'הכנה❤️',
      username: 'dana_got_auto',
      hoursAgo: 10,
      replies: [{ id: 'r1', text: 'שלחתי לך בפרטי ❤️', from: { username: ACCOUNT.username, id: ACCOUNT.ig_user_id } }],
    }),
    comment({ id: 'c2', text: 'הכנה', username: 'noa_manual', hoursAgo: 20 }),
    comment({ id: 'c3', text: '  הכנה  ', username: 'tamar_eligible', hoursAgo: 24 }),
    comment({ id: 'c4', text: '״הכנה״', username: 'shira_old', hoursAgo: 8 * 24 }),
    comment({ id: 'c5', text: 'הכנה', username: 'yael_prior', hoursAgo: 12 }),
    comment({ id: 'c6', text: 'הכנה', username: 'michal_unrelated', hoursAgo: 6 }),
    comment({ id: 'c7', text: 'כל הכבוד', username: 'ignore_me', hoursAgo: 2 }),
    comment({ id: 'own', text: 'הכנה', username: ACCOUNT.username, hoursAgo: 3, fromId: ACCOUNT.ig_user_id }),
  ];

  const conversations = [
    convo('dana_got_auto', [
      {
        created_time: new Date(NOW.getTime() - 9 * 3600000).toISOString(),
        from: { username: ACCOUNT.username, id: ACCOUNT.ig_user_id },
        message: 'היי! שמחה שאהבת 😊 רוצה שאשלח לך את הפרטים? כן, אשמח ❤️',
      },
    ]),
    convo('noa_manual', [
      {
        created_time: new Date(NOW.getTime() - 18 * 3600000).toISOString(),
        from: { username: ACCOUNT.username, id: ACCOUNT.ig_user_id },
        message: 'היי נועה, פרטי ההכנה ללידה וקישור להרשמה: https://example.com/lida המחיר והמפגש בזום אצלך בהודעה.',
      },
    ]),
    convo('yael_prior', [
      {
        created_time: new Date(NOW.getTime() - 30 * 3600000).toISOString(),
        from: { username: ACCOUNT.username, id: ACCOUNT.ig_user_id },
        message: 'היי יעל, שלחתי לך כבר את פרטי ההכנה ללידה ואת הקישור.',
      },
    ]),
    convo('michal_unrelated', [
      {
        created_time: new Date(NOW.getTime() - 5 * 3600000).toISOString(),
        from: { username: ACCOUNT.username, id: ACCOUNT.ig_user_id },
        message: 'היי מה נשמע? רק רציתי לאחל שבת שלום',
      },
    ]),
  ];

  const result = buildAudit({
    media: { id: 'm1', caption: 'הגיבי ״הכנה״ ואשלח לך את כל הפרטים❤️', permalink: 'https://instagram.com/p/x' },
    comments,
    conversations,
    account: ACCOUNT,
    keyword: 'הכנה',
    now: NOW,
    conversationsAvailable: true,
  });

  assert.equal(result.counts.total, 6);
  const byUser = Object.fromEntries(result.items.map((i) => [i.username, i]));

  assert.equal(byUser.dana_got_auto.dm_status, 'already_got_dm');
  assert.equal(byUser.dana_got_auto.dm_source, 'automated');
  assert.equal(byUser.dana_got_auto.public_reply, true);
  assert.match(byUser.dana_got_auto.dm_snippet, /שמחה שאהבת/);
  assert.equal(byUser.dana_got_auto.timestamp_jerusalem.includes('Asia/Jerusalem'), true);

  assert.equal(byUser.noa_manual.dm_status, 'already_got_dm');
  assert.equal(byUser.noa_manual.dm_source, 'manual');
  assert.match(byUser.noa_manual.dm_snippet, /הכנה ללידה/);

  assert.equal(byUser.tamar_eligible.dm_status, 'eligible_private_reply');
  assert.equal(byUser.tamar_eligible.borderline, false);

  assert.equal(byUser.shira_old.dm_status, 'not_eligible');
  assert.ok(byUser.shira_old.age_days >= 7);

  assert.equal(byUser.yael_prior.dm_status, 'eligible_private_reply');
  assert.equal(byUser.yael_prior.borderline, true);
  assert.equal(byUser.yael_prior.borderline_reason, 'prior_dm_only');
  assert.equal(byUser.yael_prior.prior_dm, true);

  assert.equal(byUser.michal_unrelated.dm_status, 'already_got_dm');
  assert.equal(byUser.michal_unrelated.borderline, true);
  assert.equal(byUser.michal_unrelated.borderline_reason, 'unrelated_content');

  assert.equal(result.groups.borderline.length, 2);
  assert.ok(!result.items.some((i) => i.username === 'ignore_me'));
  assert.ok(!result.items.some((i) => i.username === ACCOUNT.username));
});

test('when conversations API is unavailable, comments stay unknown and are flagged', () => {
  const result = buildAudit({
    media: { id: 'm1', caption: 'הגיבי ״הכנה״ ואשלח לך את כל הפרטים❤️' },
    comments: [comment({ id: 'c1', text: 'הכנה', username: 'tamar', hoursAgo: 5 })],
    conversations: [],
    account: ACCOUNT,
    keyword: 'הכנה',
    now: NOW,
    conversationsAvailable: false,
  });
  assert.equal(result.items[0].dm_status, 'unknown');
  assert.equal(result.items[0].borderline_reason, 'conversations_unavailable');
  assert.equal(result.conversations_available, false);
});


const OPENING_TEXT = 'היי, איזה כיף שאת מתעניינת בקורס הכנה ללידה שלי! ❤️';

async function setupManualSend() {
  const db = await createDb(':memory:');
  const config = {
    mockMode: true,
    appUrl: 'http://localhost:3000',
    followCheckMode: 'stub',
    sessionSecret: 'test-secret',
    sessionTtlDays: 30,
    authMode: 'facebook',
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
    media_id: 'mock_media_hakana',
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

test('manual send posts a public reply and opening DM, records a recipient, and is idempotent', async () => {
  const { db, instagram, engine, account, auto } = await setupManualSend();
  const now = new Date('2026-11-20T13:50:00Z');
  const first = await sendManualOpeningDm({
    db,
    instagram,
    engine,
    account,
    commentId: 'mock_c_tamar',
    now,
  });
  assert.equal(first.ok, true);
  assert.equal(first.message, 'ההודעה נשלחה');
  assert.equal(first.automation_id, auto.id);
  assert.ok(first.recipient_id);

  const recs = await db.listRecipients(auto.id);
  assert.equal(recs.length, 1);
  assert.equal(recs[0].comment_id, 'mock_c_tamar');
  assert.equal(recs[0].username, 'tamar_eligible');
  assert.equal(recs[0].status, 'opening_sent');
  assert.ok(recs[0].opening_sent_at);
  assert.ok(recs[0].dm_sent_at);
  assert.ok(recs[0].public_reply_sent_at);
  assert.equal(await db.hasPublicReply('mock_c_tamar'), true);

  const logs = await db.listOutbound({ accountId: account.id, limit: 20 });
  const privates = logs.filter((l) => l.type === 'private_reply');
  assert.equal(privates.length, 1);
  assert.equal(logs.some((l) => l.type === 'comment_reply'), true);
  const payload = JSON.parse(privates[0].payload);
  assert.equal(payload.body.message.text, OPENING_TEXT);
  assert.equal(payload.body.recipient.comment_id, 'mock_c_tamar');
  assert.ok(Array.isArray(payload.body.message.quick_replies));
  assert.equal(payload.body.message.quick_replies[0].title, 'כן, אשמח ❤️');

  const second = await sendManualOpeningDm({
    db,
    instagram,
    engine,
    account,
    commentId: 'mock_c_tamar',
    now,
  });
  assert.equal(second.ok, false);
  assert.equal(second.error, 'already_sent');
  assert.equal(second.status, 409);
  assert.equal(second.recipient_id, first.recipient_id);
  assert.equal((await db.listRecipients(auto.id)).length, 1);
  assert.equal((await db.listOutbound({ accountId: account.id, limit: 20 })).filter((l) => l.type === 'private_reply').length, 1);

  // same commenter, later comment: no second DM (shared recipient), but a public reply is posted once for the new comment
  const hooked = await processPayload(
    mockCommentPayload({
      igUserId: account.ig_user_id,
      commentId: 'mock_c_tamar_later',
      text: 'הכנה',
      mediaId: auto.media_id,
      fromId: 'id_tamar',
      fromUsername: 'tamar_eligible',
    }),
    { db, engine }
  );
  assert.equal((await db.listRecipients(auto.id)).length, 1);
  assert.equal((await db.listOutbound({ accountId: account.id, limit: 30 })).filter((l) => l.type === 'private_reply').length, 1);
  assert.equal(await db.hasPublicReply('mock_c_tamar_later'), true);
  assert.equal(hooked[0].ok, true);
  await db.close();
});

test('manual opening DM refuses comments older than 7 days without sending', async () => {
  const { db, instagram, engine, account, auto } = await setupManualSend();
  const now = new Date('2026-11-20T13:50:00Z');
  const result = await sendManualOpeningDm({
    db,
    instagram,
    engine,
    account,
    commentId: 'mock_c_shira',
    now,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'comment_too_old');
  assert.equal((await db.listRecipients(auto.id)).length, 0);
  const logs = await db.listOutbound({ accountId: account.id, limit: 20 });
  assert.equal(logs.filter((l) => l.type === 'private_reply').length, 0);
  await db.close();
});

test('POST /api/audit/keyword-comments/:commentId/send is authenticated, idempotent, and skips expired comments', async () => {
  const { db, config, instagram, engine, account, auto } = await setupManualSend();
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

  const unauth = await req('POST', '/api/audit/keyword-comments/mock_c_tamar/send', {});
  assert.equal(unauth.status, 401);

  const login = await req('POST', '/auth/mock-login', { username: 'rona_demo' });
  assert.equal(login.json.ok, true);

  const first = await req('POST', '/api/audit/keyword-comments/mock_c_tamar/send', { media_id: 'mock_media_hakana' });
  assert.equal(first.status, 200);
  assert.equal(first.json.ok, true);
  assert.equal(first.json.message, 'ההודעה נשלחה');
  assert.equal(first.json.automation_id, auto.id);

  const second = await req('POST', '/api/audit/keyword-comments/mock_c_tamar/send', { media_id: 'mock_media_hakana' });
  assert.equal(second.status, 409);
  assert.equal(second.json.error, 'already_sent');
  assert.equal((await db.listRecipients(auto.id)).length, 1);

  const expired = await req('POST', '/api/audit/keyword-comments/mock_c_shira/send', { media_id: 'mock_media_hakana' });
  assert.equal(expired.status, 400);
  assert.equal(expired.json.error, 'comment_too_old');

  const audit = await req('GET', '/api/audit/keyword-comments?keyword=' + encodeURIComponent('הכנה'));
  assert.equal(audit.status, 200);
  const tamar = audit.json.items.find((i) => i.comment_id === 'mock_c_tamar');
  const shira = audit.json.items.find((i) => i.comment_id === 'mock_c_shira');
  assert.equal(tamar.already_recorded, true);
  assert.equal(tamar.can_send, false);
  assert.equal(tamar.dm_ok, true);
  assert.equal(tamar.public_reply_ok, true);
  assert.equal(tamar.can_send_public_reply, false);
  assert.equal(shira.can_send, false);
  const pending = (audit.json.groups && audit.json.groups.eligible_private_reply) || [];
  assert.equal(pending.some((i) => i.comment_id === 'mock_c_tamar'), false);

  } finally {
    server.close();
    await db.close();
  }
});

test('audit by automation_id uses that post, not the default הכנה caption prefix', async () => {
  const { collectCommentAudit, attachRecipientFlags } = require('../src/services/commentAudit');
  const db = await createDb(':memory:');
  const userId = await db.createUser();
  const account = await db.upsertAccount({
    userId,
    igUserId: 'ig_audit_scope',
    username: 'rona_demo',
    name: 'רונה',
    accessToken: 'mock-token',
    accountType: 'MEDIA_CREATOR',
  });
  const hakana = await db.createAutomation({
    account_id: account.id,
    name: 'הכנה',
    status: 'live',
    trigger_scope: 'specific',
    media_id: 'media_hakana',
    media_permalink: 'https://instagram.com/p/hakana',
    media_caption: 'הגיבי "הכנה" ואשלח לך את כל הפרטים❤️',
    keyword_mode: 'keywords',
    keywords: 'הכנה',
    match_type: 'whole_word',
  });
  const cake = await db.createAutomation({
    account_id: account.id,
    name: 'עוגה',
    status: 'live',
    trigger_scope: 'specific',
    media_id: 'media_cake',
    media_permalink: 'https://instagram.com/reel/cake',
    media_caption: 'ריל על אפידורל — הגיבי עוגה',
    keyword_mode: 'keywords',
    keywords: 'עוגה',
    match_type: 'whole_word',
  });
  const now = new Date('2026-11-20T13:50:00Z');
  const instagram = {
    async findMedia(_account, { mediaId }) {
      if (mediaId === 'media_hakana') return { id: 'media_hakana', caption: hakana.media_caption, permalink: hakana.media_permalink };
      if (mediaId === 'media_cake') return { id: 'media_cake', caption: cake.media_caption, permalink: cake.media_permalink };
      return null;
    },
    async listMediaComments(_account, mediaId) {
      if (mediaId === 'media_hakana') {
        return [{ id: 'c_prep', text: 'הכנה', username: 'maya', timestamp: now.toISOString(), from: { id: '1', username: 'maya' }, replies: [] }];
      }
      if (mediaId === 'media_cake') {
        return [{ id: 'c_cake', text: 'עוגה', username: 'noa', timestamp: now.toISOString(), from: { id: '2', username: 'noa' }, replies: [] }];
      }
      return [];
    },
    async listConversationsWithMessages() {
      return { ok: false, conversations: [], errors: [], tried: [] };
    },
  };

  const cakeOnly = await collectCommentAudit(instagram, account, { automationId: cake.id, now }, db);
  assert.equal(cakeOnly.ok, true);
  assert.equal(cakeOnly.items.length, 1);
  assert.equal(cakeOnly.items[0].comment_id, 'c_cake');
  assert.equal(cakeOnly.items[0].username, 'noa');
  assert.equal(cakeOnly.items[0].automation_name, 'עוגה');
  assert.equal(cakeOnly.items.some((i) => i.comment_id === 'c_prep'), false);

  const all = await collectCommentAudit(instagram, account, { automationId: 'all', now }, db);
  assert.equal(all.ok, true);
  assert.equal(all.items.length, 2);
  assert.deepEqual(all.items.map((i) => i.comment_id).sort(), ['c_cake', 'c_prep']);
  assert.equal(all.automations.length, 2);

  // Legacy keyword+caption_prefix path is unchanged and still targets the הכנה post when no automation_id is sent.
  const instagramLegacy = createInstagramClient({
    config: { mockMode: true, appUrl: 'http://localhost:3000', followCheckMode: 'stub', meta: { apiVersion: 'v23.0', appId: '', appSecret: '', scopes: [] } },
    db,
  });
  const { collectKeywordCommentAudit } = require('../src/services/commentAudit');
  const legacy = await collectKeywordCommentAudit(instagramLegacy, account, { keyword: 'עוגה' });
  // default caption prefix points at the הכנה mock post, so "עוגה" should not match those comments
  assert.equal(legacy.ok, true);
  assert.equal((legacy.items || []).length, 0);

  await attachRecipientFlags(db, account, cakeOnly);
  await db.close();
});


test('owner public reply without a DM is handled_by_owner, not eligible', async () => {
  const comments = [
    comment({
      id: 'c_esther',
      text: 'הכנה',
      username: 'esther16930',
      hoursAgo: 10,
      replies: [{ id: 'r_esther', text: 'אצלך בפרטי ❤️', from: { username: ACCOUNT.username, id: ACCOUNT.ig_user_id } }],
    }),
    comment({ id: 'c_open', text: 'הכנה', username: 'tamar_eligible', hoursAgo: 8 }),
  ];
  const result = buildAudit({
    media: { id: 'm1', caption: 'הגיבי ״הכנה״ ואשלח לך את כל הפרטים❤️' },
    comments,
    conversations: [],
    account: ACCOUNT,
    keyword: 'הכנה',
    now: NOW,
    conversationsAvailable: true,
  });
  const byUser = Object.fromEntries(result.items.map((i) => [i.username, i]));
  assert.equal(byUser.esther16930.dm_status, 'handled_by_owner');
  assert.equal(byUser.esther16930.public_reply, true);
  assert.equal(byUser.tamar_eligible.dm_status, 'eligible_private_reply');
  assert.equal(result.counts.handled_by_owner, 1);
  assert.equal(result.counts.eligible_private_reply, 1);
  assert.equal(result.groups.eligible_private_reply.some((i) => i.username === 'esther16930'), false);

  const db = await createDb(':memory:');
  const userId = await db.createUser();
  const account = await db.upsertAccount({
    userId,
    igUserId: ACCOUNT.ig_user_id,
    username: ACCOUNT.username,
    name: 'רונה',
    accessToken: 'mock-token',
    accountType: 'MEDIA_CREATOR',
  });
  await attachRecipientFlags(db, account, result);
  const esther = result.items.find((i) => i.username === 'esther16930');
  assert.equal(esther.dm_status, 'handled_by_owner');
  assert.equal(esther.can_send, false);
  assert.equal(esther.can_send_public_reply, false);
  const tamar = result.items.find((i) => i.username === 'tamar_eligible');
  assert.equal(tamar.can_send, true);
  await db.close();
});

test('conversations unavailable still marks an owner public reply as handled_by_owner', () => {
  const result = buildAudit({
    media: { id: 'm1', caption: 'הגיבי ״הכנה״ ואשלח לך את כל הפרטים❤️' },
    comments: [comment({
      id: 'c1',
      text: 'הכנה',
      username: 'mirit',
      hoursAgo: 5,
      replies: [{ id: 'r1', text: 'שלחתי לך בפרטי ❤️', from: { username: ACCOUNT.username, id: ACCOUNT.ig_user_id } }],
    })],
    conversations: [],
    account: ACCOUNT,
    keyword: 'הכנה',
    now: NOW,
    conversationsAvailable: false,
  });
  assert.equal(result.items[0].dm_status, 'handled_by_owner');
  assert.equal(result.items[0].borderline_reason, null);
  assert.equal(result.counts.handled_by_owner, 1);
  assert.equal(result.counts.unknown_dm, 0);
});

test('app-recorded public reply with no DM stays eligible so a missing DM can still be sent', async () => {
  const db = await createDb(':memory:');
  const userId = await db.createUser();
  const account = await db.upsertAccount({
    userId,
    igUserId: ACCOUNT.ig_user_id,
    username: ACCOUNT.username,
    name: 'רונה',
    accessToken: 'mock-token',
    accountType: 'MEDIA_CREATOR',
  });
  const auto = await db.createAutomation({
    account_id: account.id,
    name: 'הכנה',
    status: 'live',
    trigger_scope: 'specific',
    media_id: 'm1',
    keyword_mode: 'keywords',
    keywords: 'הכנה',
    match_type: 'whole_word',
  });
  const rec = await db.createRecipient({
    automation_id: auto.id,
    account_id: account.id,
    comment_id: 'c_app',
    igsid: 'id_noa',
    username: 'noa',
    status: 'pending',
  });
  await db.updateRecipient(rec.id, { public_reply_sent_at: '2026-11-20 10:00:00' });
  await db.recordObservedPublicReply({ commentId: 'c_app', accountId: account.id, recipientId: rec.id, source: 'app' });

  const result = buildAudit({
    media: { id: 'm1', caption: 'הגיבי ״הכנה״ ואשלח לך את כל הפרטים❤️' },
    comments: [comment({
      id: 'c_app',
      text: 'הכנה',
      username: 'noa',
      hoursAgo: 4,
      replies: [{ id: 'r_app', text: 'שלחתי לך בפרטי ❤️', from: { username: ACCOUNT.username, id: ACCOUNT.ig_user_id } }],
    })],
    conversations: [],
    account: ACCOUNT,
    keyword: 'הכנה',
    now: NOW,
    conversationsAvailable: true,
  });
  assert.equal(result.items[0].dm_status, 'handled_by_owner');
  await attachRecipientFlags(db, account, result);
  assert.equal(result.items[0].dm_status, 'eligible_private_reply');
  assert.equal(result.items[0].can_send, true);
  assert.equal(result.items[0].app_public_reply, true);
  await db.close();
});

test('listOutbound fills automation name and username from comment_id when joins are empty', async () => {
  const db = await createDb(':memory:');
  const userId = await db.createUser();
  const account = await db.upsertAccount({
    userId,
    igUserId: ACCOUNT.ig_user_id,
    username: ACCOUNT.username,
    name: 'רונה',
    accessToken: 'mock-token',
    accountType: 'MEDIA_CREATOR',
  });
  const auto = await db.createAutomation({
    account_id: account.id,
    name: 'עוגה',
    status: 'live',
    trigger_scope: 'specific',
    media_id: 'm_cake',
    keyword_mode: 'keywords',
    keywords: 'עוגה',
    match_type: 'whole_word',
  });
  await db.createRecipient({
    automation_id: auto.id,
    account_id: account.id,
    comment_id: 'c_journal',
    igsid: 'id_noa',
    username: 'noa_cake',
    status: 'opening_sent',
  });
  await db.logOutbound({
    accountId: account.id,
    type: 'comment_reply',
    payload: { type: 'comment_reply', comment_id: 'c_journal', message: 'שלחתי לך בפרטי ❤️' },
    mock: true,
  });
  await db.logOutbound({
    accountId: account.id,
    type: 'private_reply',
    payload: { body: { recipient: { comment_id: 'c_journal' }, message: { text: 'היי' } } },
    mock: true,
  });
  const logs = await db.listOutbound({ accountId: account.id, limit: 10 });
  assert.equal(logs.length, 2);
  for (const row of logs) {
    assert.equal(row.automation_name, 'עוגה');
    assert.equal(row.recipient_username, 'noa_cake');
  }
  await db.close();
});
