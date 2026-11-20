const { partnerSeedForAccount } = require('../lib/partners-seed');
const { buildWeeklySummary, whatWorks, computeMediaTrends, mergeAccountInsights, generateRecommendations } = require('../lib/insights');
const { MOCK_MEDIA } = require('./instagram');

async function seedDemoAutomation(db, accountId) {
  const existing = await db.listAutomations(accountId);
  if (existing.length) return existing[0];
  return await db.createAutomation({
    account_id: accountId,
    name: 'מתכון — הכנה',
    status: 'live',
    trigger_scope: 'specific',
    media_id: 'mock_media_reel_cake',
    media_permalink: 'https://www.instagram.com/reel/mock_cake/',
    media_thumbnail: 'https://placehold.co/800x1000/f8c8d8/4a1c2b?text=Reel',
    media_caption: 'הכנה של העוגה האהובה 🍰 שמרו לכם!',
    media_type: 'VIDEO',
    next_pending: 0,
    keyword_mode: 'keywords',
    keywords: 'הכנה, מתכון, אני רוצה',
    match_type: 'whole_word',
    public_reply_enabled: 1,
    public_reply_variants: JSON.stringify([
      'איזה כיף! שלחתי לך הודעה בפרטי ❤️',
      'שולחת לך עכשיו בפרטי 💌',
    ]),
    opening_dm_enabled: 1,
    opening_dm_text: 'היי! שמחה שאהבת 😊 רוצה שאשלח לך את ההכנה המלאה?',
    opening_dm_button_label: 'כן, אשמח ❤️',
    must_follow: 0,
    collect_email: 0,
    second_dm_text: 'הנה ההכנה המלאה מחכה לך כאן 👇',
    second_dm_link_url: 'https://example.com/recipe',
    second_dm_link_title: 'למתכון',
    followup_enabled: 1,
    followup_hours: 24,
    followup_text: 'היי, רק רציתי לוודא שקיבלת את הלינק 💕',
  });
}

async function seedCourseAutomation(db, accountId) {
  const existing = await db.listAutomations(accountId);
  if (existing.some((a) => a.media_id === 'mock_media_reel_course' || a.name.includes('קורס'))) {
    return existing.find((a) => a.media_id === 'mock_media_reel_course' || a.name.includes('קורס'));
  }
  return db.createAutomation({
    account_id: accountId,
    name: 'קורס הכנה ללידה',
    status: 'live',
    trigger_scope: 'specific',
    media_id: 'mock_media_reel_course',
    media_permalink: 'https://www.instagram.com/reel/mock_course/',
    media_thumbnail: 'https://placehold.co/800x1000/f3d0d8/5a2434?text=Course',
    media_caption: 'קורס הכנה ללידה — מה באמת עושים במפגשים? כתבו "קורס" ואשלח פרטים 💗',
    media_type: 'VIDEO',
    next_pending: 0,
    keyword_mode: 'keywords',
    keywords: 'קורס, פרטים, רוצה, לידה',
    match_type: 'whole_word',
    public_reply_enabled: 1,
    public_reply_variants: JSON.stringify([
      'איזה כיף שהתעניינת! שלחתי לך פרטים בפרטי 💗',
    ]),
    opening_dm_enabled: 1,
    opening_dm_text: 'היי, שמחה שהגעת אליי 🌸 הקורס להכנה ללידה פותח מחזור חדש. רוצה שאשלח פרטים?',
    opening_dm_button_label: 'כן, לשלוח פרטים',
    must_follow: 0,
    collect_email: 0,
    second_dm_text: 'הנה כל הפרטים על הקורס, כולל מועדים ומחיר 👇',
    second_dm_link_url: 'https://example.com/course',
    second_dm_link_title: 'לפרטי הקורס',
    followup_enabled: 1,
    followup_hours: 24,
    followup_text: 'היי, רק וידאתי שקיבלת את פרטי הקורס 💕 יש מקום במחזור הקרוב.',
  });
}

function hoursAgo(hours) {
  return new Date(Date.now() - hours * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);
}

async function seedDemoRecipientsAndLeads(db, accountId, recipeAuto, courseAuto) {
  const existing = await db.listRecipientsByAccount(accountId);
  if (existing.length) return;

  const recipePeople = [
    { username: 'noa_lev', comment_text: 'הכנה בבקשה!', status: 'clicked', hours: 20, clicked: 8, button: 12 },
    { username: 'michal.b', comment_text: 'אני רוצה את המתכון', status: 'button_pressed', hours: 30, button: 20 },
    { username: 'dana_mom', comment_text: 'מתכון 🙏', status: 'opening_sent', hours: 10 },
    { username: 'shira88', comment_text: 'הכנה', status: 'comment_only', hours: 40, publicOnly: true },
  ];
  for (const p of recipePeople) {
    const rec = await db.createRecipient({
      automation_id: recipeAuto.id,
      account_id: accountId,
      comment_id: `mock_c_${p.username}`,
      igsid: `igsid_${p.username}`,
      username: p.username,
      comment_text: p.comment_text,
      media_id: recipeAuto.media_id,
      status: p.status,
      opening_sent_at: p.publicOnly ? null : hoursAgo(p.hours),
      dm_sent_at: p.publicOnly ? null : hoursAgo(p.hours),
      public_reply_sent_at: hoursAgo(p.hours + 0.05),
    });
    await db.updateRecipient(rec.id, {
      button_pressed_at: p.button ? hoursAgo(p.button) : null,
      clicked_at: p.clicked ? hoursAgo(p.clicked) : null,
      second_sent_at: p.clicked || p.button ? hoursAgo((p.clicked || p.button) - 1) : null,
    });
  }

  const coursePeople = [
    { username: 'yael_tal', comment_text: 'קורס!', status: 'clicked', hours: 18, clicked: 6, button: 14, fields: { week: 28, region: 'תל אביב' } },
    { username: 'oriya.s', comment_text: 'רוצה פרטים על הלידה', status: 'second_sent', hours: 26, button: 16 },
    { username: 'tamar_h', comment_text: 'פרטים בבקשה', status: 'opening_sent', hours: 8 },
    { username: 'lihi_m', comment_text: 'קורס הכנה', status: 'opening_sent', hours: 50 },
    { username: 'noga_k', comment_text: 'לידה בקרוב, רוצה קורס', status: 'comment_only', hours: 36, publicOnly: true },
  ];
  for (const p of coursePeople) {
    const rec = await db.createRecipient({
      automation_id: courseAuto.id,
      account_id: accountId,
      comment_id: `mock_c_${p.username}`,
      igsid: `igsid_${p.username}`,
      username: p.username,
      comment_text: p.comment_text,
      media_id: courseAuto.media_id,
      status: p.status,
      opening_sent_at: p.publicOnly ? null : hoursAgo(p.hours),
      dm_sent_at: p.publicOnly ? null : hoursAgo(p.hours),
      public_reply_sent_at: hoursAgo(p.hours + 0.05),
    });
    await db.updateRecipient(rec.id, {
      button_pressed_at: p.button ? hoursAgo(p.button) : null,
      clicked_at: p.clicked ? hoursAgo(p.clicked) : null,
      second_sent_at: p.clicked || p.status === 'second_sent' ? hoursAgo((p.clicked || p.button || 15) - 1) : null,
    });
  }

  // A manual lead with future-proof fields (name / week / region) not tied to a comment.
  await db.createLead({
    account_id: accountId,
    automation_id: courseAuto.id,
    source: 'manual',
    status: 'qualified',
    username: 'friend_referral',
    fields: { name: 'מאיה', week: 32, region: 'רעננה', notes: 'הגיעה מהמלצת חברה' },
  });
}

async function seedPartnersIfEmpty(db, accountId) {
  if (!db || accountId == null) return { seeded: 0, skipped: true };
  const existing = await db.countPartners(accountId);
  if (existing > 0) return { seeded: 0, skipped: true, existing };
  const rows = partnerSeedForAccount(accountId);
  let seeded = 0;
  for (const row of rows) {
    await db.createPartner(row);
    seeded += 1;
  }
  return { seeded, skipped: false };
}

async function seedDemoPartners(db, accountId) {
  return seedPartnersIfEmpty(db, accountId);
}

async function seedPartnersForExistingAccounts(db) {
  const accounts = typeof db.listAccounts === 'function'
    ? await db.listAccounts()
    : (await db.listAccountsWithTokens());
  const results = [];
  for (const acc of accounts || []) {
    results.push({ account_id: acc.id, ...(await seedPartnersIfEmpty(db, acc.id)) });
  }
  return results;
}

async function seedDemoWeeklySummary(db, accountId, instagram, account) {
  const existing = await db.getLatestWeeklySummary(accountId);
  if (existing) return existing;
  const media = instagram && instagram.mockMedia
    ? instagram.mockMedia
    : MOCK_MEDIA;
  const now = new Date();
  const trends = computeMediaTrends(media, 7, now);
  const withInsights = mergeAccountInsights(
    trends,
    {
      data: [
        { name: 'reach', total_value: { value: 4120 }, values: [{ value: 4120 }] },
        { name: 'views', total_value: { value: 7340 }, values: [{ value: 7340 }] },
        { name: 'accounts_engaged', total_value: { value: 980 }, values: [{ value: 980 }] },
      ],
    },
    {
      data: [
        { name: 'reach', total_value: { value: 3510 }, values: [{ value: 3510 }] },
        { name: 'views', total_value: { value: 8010 }, values: [{ value: 8010 }] },
        { name: 'accounts_engaged', total_value: { value: 860 }, values: [{ value: 860 }] },
      ],
    },
    4860,
    4720
  );
  withInsights.followers = { current: 4860, previous: 4720, growth: 140, delta: 3 };
  const works = whatWorks(media, 7, now);
  const recs = generateRecommendations({ media, automations: await db.listAutomations(accountId), trends: withInsights, what_works: works, now });
  const built = buildWeeklySummary({ trends: withInsights, what_works: works, recommendations: recs, now });
  return db.upsertWeeklySummary({
    accountId,
    weekStart: built.week_start,
    body: built.body,
    points: built.points,
  });
}

async function seedDemoInsights(db, accountId, instagram, account) {
  const existing = await db.listAutomations(accountId);
  const recipe = await seedDemoAutomation(db, accountId);
  // Tests may have already created automations on the account. Don't add extra
  // demo recipients or a second automation in that case.
  if (existing.length) return { recipe, course: existing.find((a) => a.name.includes('קורס')) || null };
  const course = await seedCourseAutomation(db, accountId);
  await seedDemoRecipientsAndLeads(db, accountId, recipe, course);
  await seedDemoPartners(db, accountId);
  await seedDemoWeeklySummary(db, accountId, instagram, account || { id: accountId });
  return { recipe, course };
}

module.exports = { seedDemoAutomation, seedDemoInsights, seedCourseAutomation, seedPartnersIfEmpty, seedPartnersForExistingAccounts, seedDemoPartners };
