const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { once } = require('events');
const {
  computeMediaTrends,
  whatWorks,
  generateRecommendations,
  buildWeeklySummary,
  renderSummaryEmail,
  parseGraphInsights,
  mergeAccountInsights,
  engagementOf,
} = require('../src/lib/insights');
const { buildFunnels, funnelFromAudit, recipientToLeadDraft, statusFromRecipient } = require('../src/lib/leads');
const { buildAudit } = require('../src/lib/audit');
const { attachRecipientFlags } = require('../src/services/commentAudit');
const { collectInsights } = require('../src/services/insights');
const { seedPartnersIfEmpty } = require('../src/services/seed');
const { getCachedInsights, clearInsightsCache } = require('../src/services/insightsCache');
const { weekStartSundayJerusalem, jerusalemParts, isSundayNineJerusalem } = require('../src/lib/time');
const { emailConfigured, sendEmail } = require('../src/lib/email');
const { createDb } = require('../src/db');
const { createApp } = require('../src/app');
const { createInstagramClient } = require('../src/services/instagram');
const { PARTNER_SEED } = require('../src/lib/partners-seed');

const NOW = new Date('2026-11-20T12:00:00+02:00');

const MEDIA = [
  { id: 'r1', caption: 'ריל על נשימות בלידה', media_type: 'VIDEO', media_product_type: 'REELS', timestamp: '2026-11-18T18:00:00+02:00', like_count: 200, comments_count: 40, permalink: 'https://instagram.com/p/r1' },
  { id: 'c1', caption: 'קרוסלת תיק ללידה', media_type: 'CAROUSEL_ALBUM', timestamp: '2026-11-16T19:00:00+02:00', like_count: 80, comments_count: 10 },
  { id: 'i1', caption: 'ציטוט', media_type: 'IMAGE', timestamp: '2026-11-15T09:00:00+02:00', like_count: 20, comments_count: 2 },
  { id: 'r0', caption: 'ריל ישן חזק', media_type: 'VIDEO', media_product_type: 'REELS', timestamp: '2026-11-10T18:00:00+02:00', like_count: 150, comments_count: 30 },
  { id: 'i0', caption: 'תמונה ישנה', media_type: 'IMAGE', timestamp: '2026-11-08T09:00:00+02:00', like_count: 10, comments_count: 1 },
];

test('engagement is likes plus comments unless total_interactions is set', () => {
  assert.equal(engagementOf({ like_count: 10, comments_count: 3 }), 13);
  assert.equal(engagementOf({ like_count: 10, comments_count: 3, total_interactions: 40 }), 40);
});

test('media trends compare the selected period to the previous window', () => {
  const t = computeMediaTrends(MEDIA, 7, NOW);
  assert.equal(t.source, 'media_fields');
  assert.equal(t.insights_available, false);
  assert.equal(t.current.posts, 3);
  assert.equal(t.previous.posts, 2);
  assert.ok(t.current.engagement > t.previous.engagement);
  assert.ok(t.deltas.engagement > 0);
});

test('what works ranks top posts, content types, and Jerusalem days/hours', () => {
  const w = whatWorks(MEDIA, 30, NOW);
  assert.equal(w.top_posts[0].id, 'r1');
  assert.equal(w.best_content_type.type, 'REELS');
  assert.equal(w.best_content_type.label, 'רילס');
  assert.ok(w.best_days.length >= 1);
  assert.ok(w.best_hours.some((h) => h.hour === 18 || h.hour === 19));
  const wednesdayOr = w.days.find((d) => d.label === 'רביעי' || d.weekday === 3);
  assert.ok(wednesdayOr);
});

test('recommendations include best time, content type, and unmatched high-comment posts', () => {
  const media = [
    ...MEDIA,
    { id: 'hot', caption: 'שאלו אותי על אפידורל', media_type: 'VIDEO', media_product_type: 'REELS', timestamp: '2026-11-17T18:00:00+02:00', like_count: 50, comments_count: 80 },
  ];
  const recs = generateRecommendations({
    media,
    automations: [{ media_id: 'r1', keywords: 'קורס' }],
    comments: [
      { text: 'אפידורל' }, { text: 'אפידורל?' }, { text: 'גם אני אפידורל' },
    ],
    trends: computeMediaTrends(media, 7, NOW),
    now: NOW,
  });
  assert.ok(recs.length >= 2 && recs.length <= 3);
  assert.ok(recs.some((r) => r.id === 'best_time'));
  assert.ok(recs.some((r) => r.id === 'content_type' || r.id === 'automation_opportunity' || r.id === 'missing_keyword'));
  assert.ok(recs.some((r) => r.id === 'automation_opportunity' && r.body.includes('אפידורל')));
});

test('weekly summary includes improved, dropped, recommendation, and what-works details', () => {
  const trends = mergeAccountInsights(
    computeMediaTrends(MEDIA, 7, NOW),
    { data: [
      { name: 'reach', total_value: { value: 4000 } },
      { name: 'views', total_value: { value: 5000 } },
    ] },
    { data: [
      { name: 'reach', total_value: { value: 3000 } },
      { name: 'views', total_value: { value: 8000 } },
    ] },
    4860,
    4700
  );
  const works = whatWorks(MEDIA, 7, NOW);
  const recs = generateRecommendations({ media: MEDIA, automations: [], trends, what_works: works, now: NOW });
  const summary = buildWeeklySummary({ trends, what_works: works, recommendations: recs, now: NOW });
  assert.match(summary.body, /מה השתפר/);
  assert.match(summary.body, /מה ירד/);
  assert.match(summary.body, /מה עובד/);
  assert.match(summary.body, /המלצה/);
  assert.ok(summary.points.improved);
  assert.ok(summary.points.dropped);
  assert.ok(summary.points.recommendation);
  assert.ok(summary.points.what_works.text);
  assert.ok(summary.points.what_works.top_posts.length >= 1);
  assert.equal(summary.points.what_works.best_content_type.type, 'REELS');
  assert.ok(summary.points.what_works.best_days.length >= 1);
  assert.ok(summary.points.what_works.best_hours.length >= 1);
  assert.match(summary.points.dropped, /הצפיות|ירדה/);
  assert.match(summary.points.improved, /החשיפה|המעורבות|עלתה/);

  const email = renderSummaryEmail({ accountName: 'רונה', username: 'ronaazarya_midwife', summary });
  assert.match(email.subject, /הסיכום השבועי/);
  assert.match(email.text, /מה עובד/);
  assert.match(email.text, /פוסטים ורילס מובילים|סוג תוכן מוביל|ימים חזקים/);
  assert.match(email.html, /<h2>מה עובד<\/h2>/);
  assert.match(email.html, /<h2>מה השתפר<\/h2>/);
  assert.match(email.html, /<h2>המלצה<\/h2>/);
  assert.match(email.html, /רילס/);
});

test('parseGraphInsights reads total_value and daily values', () => {
  const parsed = parseGraphInsights({
    data: [{ name: 'reach', total_value: { value: 12 }, values: [{ value: 5, end_time: 'a' }, { value: 7, end_time: 'b' }] }],
  });
  assert.equal(parsed.reach.total, 12);
  assert.equal(parsed.reach.values.length, 2);
});

test('Jerusalem week starts on Sunday and Sunday 09:00 is detected', () => {
  const sundayMorning = new Date('2026-11-15T09:10:00+02:00');
  const parts = jerusalemParts(sundayMorning);
  assert.equal(parts.weekday, 0);
  assert.equal(parts.hour, 9);
  assert.equal(isSundayNineJerusalem(sundayMorning), true);
  assert.equal(isSundayNineJerusalem(new Date('2026-11-15T10:00:00+02:00')), false);
  assert.equal(weekStartSundayJerusalem(new Date('2026-11-18T15:00:00+02:00')), '2026-11-15');
});

test('email helper skips when env is not configured and uses a transport when given', async () => {
  assert.equal(emailConfigured({ summary: {} }), false);
  assert.equal(emailConfigured({ summary: { emailTo: 'a@b.com' } }), false);
  assert.equal(emailConfigured({ summary: { emailTo: 'a@b.com', resendApiKey: 're_x' } }), true);
  const skipped = await sendEmail({ summary: {} }, { subject: 'x', text: 'y' });
  assert.equal(skipped.skipped, true);
  const sent = await sendEmail(
    { summary: { emailTo: 'a@b.com', resendApiKey: 're_x' } },
    { subject: 'סיכום', text: 'שלום', html: '<p>שלום</p>' },
    async (msg) => ({ provider: 'test', id: '1', message: msg })
  );
  assert.equal(sent.provider, 'test');
  assert.equal(sent.message.subject, 'סיכום');
});

test('generic lead funnel is not hard-coded to a keyword', () => {
  const automations = [
    { id: 1, name: 'קורס הכנה ללידה', keywords: 'קורס, לידה' },
    { id: 2, name: 'רשימת קניות', keywords: 'רשימה' },
  ];
  const recipients = [
    { automation_id: 1, comment_text: 'קורס', opening_sent_at: '2026-11-18 10:00:00', dm_sent_at: '2026-11-18 10:00:00', clicked_at: '2026-11-18 12:00:00', created_at: '2026-11-18 09:00:00' },
    { automation_id: 1, comment_text: 'לידה', public_reply_sent_at: '2026-11-18 11:00:00', status: 'comment_only', created_at: '2026-11-18 11:00:00' },
    { automation_id: 2, comment_text: 'רשימה', opening_sent_at: '2026-11-19 10:00:00', created_at: '2026-11-19 10:00:00' },
  ];
  const funnels = buildFunnels(automations, { recipients, leads: [] });
  assert.equal(funnels.length, 2);
  const course = funnels.find((f) => f.automation_id === 1);
  assert.equal(course.comments_matched, 2);
  assert.equal(course.sent, 1);
  assert.equal(course.handled_by_owner, 1);
  assert.equal(course.converted, 1);
  assert.equal(funnels[1].comments_matched, 1);
  const draft = recipientToLeadDraft(recipients[0], { accountId: 9 });
  assert.equal(draft.status, 'converted');
  assert.equal(statusFromRecipient({ status: 'opening_sent', opening_sent_at: 'x' }), 'contacted');
});

test('partner seed has 8+ real accounts with sources and no invented emails', () => {
  assert.ok(PARTNER_SEED.length >= 8);
  for (const p of PARTNER_SEED) {
    assert.ok(p.name);
    assert.ok(p.source_url);
    assert.match(p.source_url, /^https?:\/\//);
    assert.ok(p.why_relevant);
    if (p.email) assert.match(p.email, /@/);
    if (p.handle) assert.ok(!p.handle.startsWith('@'));
  }
  assert.ok(PARTNER_SEED.some((p) => p.handle === 'gil_dror' && p.phone === '052-2640018'));
  assert.ok(PARTNER_SEED.some((p) => p.name === 'חופית מנו' && p.email === 'hofitmano@gmail.com' && !p.handle));
  assert.ok(PARTNER_SEED.some((p) => p.handle === 'amit_walter' && !p.email && !p.phone));
});

async function withApp(fn) {
  const db = await createDb(':memory:');
  const config = {
    mockMode: true,
    nodeEnv: 'test',
    appUrl: 'http://127.0.0.1',
    sessionSecret: 'test-secret',
    sessionTtlDays: 30,
    authMode: 'facebook',
    meta: { apiVersion: 'v23.0', appId: '1', appSecret: 's', scopes: ['instagram_basic', 'instagram_manage_insights'] },
    summary: { emailTo: '', resendApiKey: '', smtpHost: '' },
  };
  const instagram = createInstagramClient({ config, db });
  const app = createApp({ db, config, instagram, engine: {} });
  const server = http.createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  clearInsightsCache();
  try {
    await fn({ db, config, instagram, port });
  } finally {
    clearInsightsCache();
    server.close();
    await db.close();
  }
}

test('insights API returns trends, what works, funnels, recommendations, partners and weekly what-works', async () => {
  await withApp(async ({ port }) => {
    const login = await fetch(`http://127.0.0.1:${port}/auth/mock-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'rona_demo' }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie');
    assert.ok(cookie);

    const res = await fetch(`http://127.0.0.1:${port}/api/insights?days=30`, { headers: { cookie } });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.insights_available, true);
    assert.ok(data.trends.reach.current > 0);
    assert.ok(data.what_works.top_posts.length >= 1);
    assert.ok(data.what_works.best_content_type);
    assert.ok(data.recommendations.length >= 1);
    assert.ok(data.funnels.length >= 2);
    assert.ok(data.funnels.some((f) => f.name.includes('קורס')));
    assert.ok(data.funnels.every((f) => 'comments_matched' in f && 'sent' in f && 'handled_by_owner' in f));
    assert.ok(data.weekly_summary);
    assert.ok(data.weekly_summary.points.what_works);
    assert.match(data.weekly_summary.body, /מה עובד/);

    const partners = await (await fetch(`http://127.0.0.1:${port}/api/partners`, { headers: { cookie } })).json();
    assert.ok(partners.partners.length >= 8);
    assert.ok(partners.partners.some((p) => p.handle === 'gil_dror'));

    const created = await fetch(`http://127.0.0.1:${port}/api/partners`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ name: 'שותפה לבדיקה', handle: 'test_handle', category: 'other' }),
    });
    assert.equal(created.status, 200);
    const partner = (await created.json()).partner;
    const enriched = await fetch(`http://127.0.0.1:${port}/api/partners/${partner.id}/enrich`, {
      method: 'POST',
      headers: { cookie },
    });
    assert.equal(enriched.status, 200);
    const en = (await enriched.json()).partner;
    assert.ok(en.enrichment);
    assert.equal(en.enrichment.username, 'test_handle');

    const leads = await (await fetch(`http://127.0.0.1:${port}/api/leads`, { headers: { cookie } })).json();
    assert.ok(leads.leads.length >= 1);
    const manual = await fetch(`http://127.0.0.1:${port}/api/leads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ source: 'manual', status: 'new', username: 'maya', fields: { week: 30, region: 'חיפה', name: 'מאיה' } }),
    });
    assert.equal(manual.status, 200);
    const lead = (await manual.json()).lead;
    assert.equal(lead.fields.week, 30);
    const patched = await fetch(`http://127.0.0.1:${port}/api/leads/${lead.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ status: 'converted', fields: { region: 'חיפה', note: 'נרשמה' } }),
    });
    assert.equal(patched.status, 200);
    const after = (await patched.json()).lead;
    assert.equal(after.status, 'converted');
    assert.equal(after.fields.week, 30);
    assert.equal(after.fields.note, 'נרשמה');
  });
});

test('weekly summary job stores a what-works section and only emails when configured', async () => {
  const { runWeeklySummaries } = require('../src/services/weeklySummary');
  const db = await createDb(':memory:');
  const config = {
    mockMode: true,
    meta: { apiVersion: 'v23.0', scopes: [] },
    summary: { emailTo: '', resendApiKey: '', smtpHost: '' },
  };
  const instagram = createInstagramClient({ config, db });
  const { seedDemoInsights } = require('../src/services/seed');
  const userId = await db.createUser();
  const account = await db.upsertAccount({
    userId,
    igUserId: 'mock_ig_weekly',
    username: 'rona_demo',
    name: 'רונה',
    accessToken: 'tok',
  });
  await seedDemoInsights(db, account.id, instagram, account);

  const sent = [];
  const noEmail = await runWeeklySummaries({ db, instagram, config, now: NOW, force: true });
  assert.equal(noEmail[0].ok, true);
  assert.equal(noEmail[0].email.skipped, true);
  assert.match(noEmail[0].summary.body, /מה עובד/);
  assert.ok(noEmail[0].summary.points.what_works.top_posts);

  config.summary = { emailTo: 'rona@example.com', resendApiKey: 're_test', smtpHost: '' };
  const withEmail = await runWeeklySummaries({
    db, instagram, config, now: NOW, force: true,
    transport: async (msg) => { sent.push(msg); return { provider: 'test', id: 'abc' }; },
  });
  assert.equal(withEmail[0].email.provider, 'test');
  assert.equal(sent.length, 1);
  assert.match(sent[0].html, /<h2>מה עובד<\/h2>/);
  assert.match(sent[0].text, /מה עובד/);
  await db.close();
});

test('default Facebook scopes include instagram_manage_insights', () => {
  const orig = { ...process.env };
  delete process.env.FACEBOOK_SCOPES;
  delete process.env.INSTAGRAM_SCOPES;
  process.env.AUTH_MODE = 'facebook';
  delete require.cache[require.resolve('../src/config')];
  const config = require('../src/config');
  assert.ok(config.meta.scopes.includes('instagram_manage_insights'));
  Object.assign(process.env, orig);
  delete require.cache[require.resolve('../src/config')];
});


function kwComment({ id, username, text, ownerReply, at }) {
  const comment = {
    id,
    text,
    username,
    timestamp: at || '2026-11-18T10:00:00+0000',
    from: { id: 'id_' + username, username },
    parent_id: null,
    replies: [],
  };
  if (ownerReply) {
    comment.replies.push({
      id: 'r_' + id,
      text: ownerReply,
      username: 'ronaazarya_midwife',
      timestamp: '2026-11-18T11:00:00+0000',
      from: { id: 'ig_rona', username: 'ronaazarya_midwife' },
      parent_id: id,
    });
  }
  return comment;
}

test('funnel per automation matches audit: keyword comments, sent DMs, handled by owner', async () => {
  const account = { id: 1, username: 'ronaazarya_midwife', ig_user_id: 'ig_rona' };
  const hakana = { id: 11, name: 'הכנה', keywords: 'הכנה', keyword_mode: 'keywords', media_id: 'media_hakana' };
  const cake = { id: 22, name: 'עוגה', keywords: 'עוגה', keyword_mode: 'keywords', media_id: 'media_cake' };

  const hakanaComments = [
    kwComment({ id: 'c1', username: 'idan_azarya_', text: 'הכנה', ownerReply: null }),
    kwComment({ id: 'c2', username: 'esther16930', text: 'הכנה בבקשה', ownerReply: null }),
    kwComment({ id: 'c3', username: 'maya1', text: 'הכנה', ownerReply: 'שלחתי לך בפרטי בעבר 💗' }),
    kwComment({ id: 'c4', username: 'maya2', text: 'הכנה', ownerReply: 'היי, כבר כתבתי לך 💗' }),
    kwComment({ id: 'c5', username: 'maya3', text: 'הכנה!', ownerReply: 'מחכה לך בקורס 💗' }),
    kwComment({ id: 'c6', username: 'maya4', text: 'הכנה', ownerReply: 'כתבתי בפרטי 💗' }),
    kwComment({ id: 'c7', username: 'maya5', text: 'הכנה', ownerReply: 'מענה ידני 💗' }),
    kwComment({ id: 'c8', username: 'other', text: 'שאלה כללית', ownerReply: null }),
  ];
  const cakeComments = [
    kwComment({ id: 'k1', username: 'dana_cake', text: 'עוגה', ownerReply: null }),
    kwComment({ id: 'k2', username: 'lina_cake', text: 'עוגה בבקשה', ownerReply: null }),
  ];

  const hakanaAudit = buildAudit({
    media: { id: 'media_hakana', caption: 'הגיבי הכנה' },
    comments: hakanaComments,
    conversations: [],
    account,
    keyword: 'הכנה',
    now: NOW,
    conversationsAvailable: false,
  });
  const cakeAudit = buildAudit({
    media: { id: 'media_cake', caption: 'עוגה' },
    comments: cakeComments,
    conversations: [],
    account,
    keyword: 'עוגה',
    now: NOW,
    conversationsAvailable: false,
  });
  assert.equal(hakanaAudit.counts.total, 7);
  assert.equal(hakanaAudit.counts.handled_by_owner, 5);

  const db = {
    async findRecipientByCommentOrUser({ commentId }) {
      const map = {
        c1: { id: 101, comment_id: 'c1', opening_sent_at: '2026-11-18 12:00:00', dm_sent_at: '2026-11-18 12:00:00', automation_id: 11 },
        c2: { id: 102, comment_id: 'c2', opening_sent_at: '2026-11-18 12:05:00', dm_sent_at: '2026-11-18 12:05:00', automation_id: 11 },
        k1: { id: 201, comment_id: 'k1', opening_sent_at: '2026-11-18 13:00:00', dm_sent_at: '2026-11-18 13:00:00', automation_id: 22 },
        k2: { id: 202, comment_id: 'k2', opening_sent_at: '2026-11-18 13:05:00', dm_sent_at: '2026-11-18 13:05:00', automation_id: 22 },
      };
      return map[commentId] || null;
    },
    async getPublicReply() { return null; },
  };

  const hakanaTagged = await attachRecipientFlags(db, account, { ok: true, items: hakanaAudit.items, counts: hakanaAudit.counts });
  const cakeTagged = await attachRecipientFlags(db, account, { ok: true, items: cakeAudit.items, counts: cakeAudit.counts });

  const recipients = [
    { automation_id: 11, comment_id: 'c1', opening_sent_at: '2026-11-18 12:00:00', dm_sent_at: '2026-11-18 12:00:00', created_at: '2026-11-18 12:00:00' },
    { automation_id: 11, comment_id: 'c2', opening_sent_at: '2026-11-18 12:05:00', dm_sent_at: '2026-11-18 12:05:00', created_at: '2026-11-18 12:05:00' },
    { automation_id: 22, comment_id: 'k1', opening_sent_at: '2026-11-18 13:00:00', dm_sent_at: '2026-11-18 13:00:00', created_at: '2026-11-18 13:00:00' },
    { automation_id: 22, comment_id: 'k2', opening_sent_at: '2026-11-18 13:05:00', dm_sent_at: '2026-11-18 13:05:00', created_at: '2026-11-18 13:05:00' },
  ];

  // Recipients-only (the production bug) would show 2/2/0 for הכנה.
  const naive = buildFunnels([hakana, cake], { recipients, leads: [] });
  assert.equal(naive.find((f) => f.automation_id === 11).comments_matched, 2);
  assert.equal(naive.find((f) => f.automation_id === 11).handled_by_owner, 0);

  const funnels = buildFunnels([hakana, cake], {
    recipients,
    leads: [],
    audits: { 11: hakanaTagged, 22: cakeTagged },
  });
  const h = funnels.find((f) => f.automation_id === 11);
  const c = funnels.find((f) => f.automation_id === 22);
  assert.equal(h.comments_matched, 7);
  assert.equal(h.sent, 2);
  assert.equal(h.handled_by_owner, 5);
  assert.equal(h.source, 'audit');
  assert.equal(c.comments_matched, 2);
  assert.equal(c.sent, 2);
  assert.equal(c.handled_by_owner, 0);
  assert.notEqual(h.comments_matched, c.comments_matched);
  const overlay = funnelFromAudit(hakana, hakanaTagged, { recipients, leads: [] });
  assert.equal(overlay.comments_matched, 7);
});

test('collectInsights builds distinct per-automation funnels from audit data', async () => {
  const db = await createDb(':memory:');
  const userId = await db.createUser();
  const account = await db.upsertAccount({
    userId,
    igUserId: 'ig_rona',
    username: 'ronaazarya_midwife',
    name: 'רונה',
    accessToken: 'tok',
  });
  const hakana = await db.createAutomation({
    account_id: account.id,
    name: 'הכנה',
    keywords: 'הכנה',
    keyword_mode: 'keywords',
    media_id: 'media_hakana',
    status: 'live',
  });
  const cake = await db.createAutomation({
    account_id: account.id,
    name: 'עוגה',
    keywords: 'עוגה',
    keyword_mode: 'keywords',
    media_id: 'media_cake',
    status: 'live',
  });
  await db.createRecipient({
    account_id: account.id, automation_id: hakana.id, comment_id: 'c1', username: 'idan_azarya_',
    opening_sent_at: '2026-11-18 12:00:00', dm_sent_at: '2026-11-18 12:00:00', status: 'opening_sent',
  });
  await db.createRecipient({
    account_id: account.id, automation_id: hakana.id, comment_id: 'c2', username: 'esther16930',
    opening_sent_at: '2026-11-18 12:05:00', dm_sent_at: '2026-11-18 12:05:00', status: 'opening_sent',
  });
  await db.createRecipient({
    account_id: account.id, automation_id: cake.id, comment_id: 'k1', username: 'dana_cake',
    opening_sent_at: '2026-11-18 13:00:00', dm_sent_at: '2026-11-18 13:00:00', status: 'opening_sent',
  });
  await db.createRecipient({
    account_id: account.id, automation_id: cake.id, comment_id: 'k2', username: 'lina_cake',
    opening_sent_at: '2026-11-18 13:05:00', dm_sent_at: '2026-11-18 13:05:00', status: 'opening_sent',
  });

  const commentsByMedia = {
    media_hakana: [
      kwComment({ id: 'c1', username: 'idan_azarya_', text: 'הכנה' }),
      kwComment({ id: 'c2', username: 'esther16930', text: 'הכנה בבקשה' }),
      kwComment({ id: 'c3', username: 'maya1', text: 'הכנה', ownerReply: 'שלחתי לך בפרטי בעבר 💗' }),
      kwComment({ id: 'c4', username: 'maya2', text: 'הכנה', ownerReply: 'היי, כבר כתבתי לך 💗' }),
      kwComment({ id: 'c5', username: 'maya3', text: 'הכנה!', ownerReply: 'מחכה לך בקורס 💗' }),
      kwComment({ id: 'c6', username: 'maya4', text: 'הכנה', ownerReply: 'כתבתי בפרטי 💗' }),
      kwComment({ id: 'c7', username: 'maya5', text: 'הכנה', ownerReply: 'מענה ידני 💗' }),
    ],
    media_cake: [
      kwComment({ id: 'k1', username: 'dana_cake', text: 'עוגה' }),
      kwComment({ id: 'k2', username: 'lina_cake', text: 'עוגה בבקשה' }),
    ],
  };
  const instagram = {
    async listMedia() {
      return [
        { id: 'media_hakana', caption: 'הגיבי הכנה', timestamp: '2026-11-10T10:00:00+0000', like_count: 10, comments_count: 7, media_type: 'VIDEO', media_product_type: 'REELS' },
        { id: 'media_cake', caption: 'עוגה', timestamp: '2026-11-12T10:00:00+0000', like_count: 8, comments_count: 2, media_type: 'VIDEO', media_product_type: 'REELS' },
      ];
    },
    async findMedia(_account, { mediaId }) {
      const all = await this.listMedia();
      return all.find((m) => m.id === mediaId) || null;
    },
    async listMediaComments(_account, mediaId) {
      return (commentsByMedia[mediaId] || []).flatMap((c) => [c, ...(c.replies || [])]);
    },
  };

  const data = await collectInsights({ db, instagram, account, days: 30, now: NOW });
  const h = data.funnels.find((f) => f.name === 'הכנה');
  const c = data.funnels.find((f) => f.name === 'עוגה');
  assert.equal(h.comments_matched, 7);
  assert.equal(h.sent, 2);
  assert.equal(h.handled_by_owner, 5);
  assert.equal(c.comments_matched, 2);
  assert.equal(c.sent, 2);
  assert.equal(c.handled_by_owner, 0);
  await db.close();
});

test('partner seed is idempotent and only runs when the account has no partners', async () => {
  const db = await createDb(':memory:');
  const userId = await db.createUser();
  const empty = await db.upsertAccount({ userId, igUserId: 'ig_empty', username: 'empty_acc', name: 'Empty', accessToken: 'tok' });
  const kept = await db.upsertAccount({ userId, igUserId: 'ig_kept', username: 'kept_acc', name: 'Kept', accessToken: 'tok' });
  await db.createPartner({ account_id: kept.id, name: 'קיימת', handle: 'existing_one', category: 'other', status: 'idea' });

  const first = await seedPartnersIfEmpty(db, empty.id);
  assert.ok(first.seeded >= 11);
  const second = await seedPartnersIfEmpty(db, empty.id);
  assert.equal(second.skipped, true);
  assert.equal(second.seeded, 0);
  assert.equal((await db.listPartners(empty.id)).length, first.seeded);

  const skipped = await seedPartnersIfEmpty(db, kept.id);
  assert.equal(skipped.skipped, true);
  const keptRows = await db.listPartners(kept.id);
  assert.equal(keptRows.length, 1);
  assert.equal(keptRows[0].handle, 'existing_one');
  await db.close();
});

test('GET /api/partners seeds the curated list for a production-like account', async () => {
  await withApp(async ({ port }) => {
    const login = await fetch(`http://127.0.0.1:${port}/auth/mock-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'rona_live' }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie');
    const first = await (await fetch(`http://127.0.0.1:${port}/api/partners`, { headers: { cookie } })).json();
    assert.ok(first.partners.length >= 11);
    assert.ok(first.partners.some((p) => p.handle === 'gil_dror'));
    const second = await (await fetch(`http://127.0.0.1:${port}/api/partners`, { headers: { cookie } })).json();
    assert.equal(second.partners.length, first.partners.length);
  });
});

test('insights cache returns immediately and refreshes in the background when stale', async () => {
  clearInsightsCache();
  let calls = 0;
  const collect = async () => {
    calls += 1;
    await new Promise((r) => setTimeout(r, 40));
    return { generated_at: 't' + calls, trends: { n: calls }, period_days: 30 };
  };
  const account = { id: 99 };
  const first = await getCachedInsights({ collect, account, days: 30, wait: true, ttlMs: 30 });
  assert.equal(first.cached, false);
  assert.equal(first.trends.n, 1);
  assert.equal(calls, 1);

  const hit = await getCachedInsights({ collect, account, days: 30, wait: true, ttlMs: 30_000 });
  assert.equal(hit.cached, true);
  assert.equal(hit.stale, false);
  assert.equal(hit.trends.n, 1);
  assert.equal(calls, 1);

  await new Promise((r) => setTimeout(r, 40));
  const stale = await getCachedInsights({ collect, account, days: 30, wait: false, ttlMs: 20, now: Date.now() });
  assert.equal(stale.cached, true);
  assert.equal(stale.stale, true);
  assert.equal(stale.refreshing, true);
  assert.equal(stale.trends.n, 1);

  const fresh = await getCachedInsights({ collect, account, days: 30, wait: true, ttlMs: 20 });
  assert.equal(fresh.cached, false);
  assert.equal(fresh.stale, false);
  assert.equal(fresh.trends.n, 2);
  assert.equal(calls, 2);
  clearInsightsCache();
});

test('GET /api/insights serves cached payload on the second request', async () => {
  await withApp(async ({ port }) => {
    const login = await fetch(`http://127.0.0.1:${port}/auth/mock-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'rona_demo' }),
    });
    const cookie = login.headers.get('set-cookie');
    const first = await (await fetch(`http://127.0.0.1:${port}/api/insights?days=30`, { headers: { cookie } })).json();
    assert.equal(first.cached, false);
    assert.ok(first.trends);
    const second = await (await fetch(`http://127.0.0.1:${port}/api/insights?days=30&wait=0`, { headers: { cookie } })).json();
    assert.equal(second.cached, true);
    assert.equal(second.stale, false);
    assert.equal(second.generated_at, first.generated_at);
  });
});

test('serialized automations expose has_tracked_link only when a button URL exists', async () => {
  await withApp(async ({ port, db }) => {
    const login = await fetch(`http://127.0.0.1:${port}/auth/mock-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'rona_demo' }),
    });
    const cookie = login.headers.get('set-cookie');
    const me = await (await fetch(`http://127.0.0.1:${port}/auth/me`, { headers: { cookie } })).json();
    const bare = await db.createAutomation({
      account_id: me.account.id,
      name: 'בלי כפתור',
      keywords: 'שלום',
      status: 'paused',
      second_dm_link_url: '',
    });
    const list = await (await fetch(`http://127.0.0.1:${port}/api/automations`, { headers: { cookie } })).json();
    const autos = list.automations || list;
    const withLink = autos.find((a) => a.second_dm_link_url);
    const without = autos.find((a) => a.id === bare.id || a.name === 'בלי כפתור');
    assert.ok(withLink);
    assert.equal(withLink.has_tracked_link, true);
    assert.ok(without);
    assert.equal(without.has_tracked_link, false);
  });
});

test('requiring db.js does not load experimental node:sqlite until a sqlite db is opened', () => {
  const { spawnSync } = require('child_process');
  const script = `
    let warned = false;
    process.on('warning', (w) => {
      if (/sqlite/i.test(String(w.message || '')) || w.name === 'ExperimentalWarning') {
        warned = true;
        console.error('WARN', w.name, w.message);
      }
    });
    require(${JSON.stringify(require('path').resolve(__dirname + '/../src/db'))});
    setTimeout(() => process.exit(warned ? 2 : 0), 80);
  `;
  const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
