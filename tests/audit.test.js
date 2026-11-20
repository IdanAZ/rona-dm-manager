const { test } = require('node:test');
const assert = require('node:assert/strict');
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
