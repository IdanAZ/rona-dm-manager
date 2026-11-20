const {
  periodWindow,
  computeMediaTrends,
  mergeAccountInsights,
  whatWorks,
  generateRecommendations,
  buildWeeklySummary,
} = require('../lib/insights');
const { buildFunnels, recipientToLeadDraft, parseLeadFields } = require('../lib/leads');
const { collectAutomationAudit, attachRecipientFlags } = require('./commentAudit');

const FALLBACK_NOTE = 'הסטטיסטיקות המלאות (חשיפה, צפיות וצמיחת עוקבות) יופיעו כאן אחרי אישור Meta להרשאת התובנות. בינתיים מוצג מה שאפשר לחשב מהפוסטים עצמם — לייקים, תגובות וזמני פרסום.';

function unixSeconds(date) {
  return Math.floor(new Date(date).getTime() / 1000);
}

async function safeCall(fn, label, errors) {
  try {
    return await fn();
  } catch (err) {
    errors.push({ label, message: err.message, code: err.code || err.status || null });
    return null;
  }
}

async function syncLeadsFromRecipients(db, accountId, automations) {
  const existing = await db.listLeads(accountId);
  const byComment = new Map();
  const byRecipient = new Map();
  for (const lead of existing) {
    if (lead.comment_id) byComment.set(String(lead.comment_id), lead);
    if (lead.recipient_id) byRecipient.set(Number(lead.recipient_id), lead);
  }
  let recipients = [];
  if (typeof db.listRecipientsByAccount === 'function') {
    recipients = await db.listRecipientsByAccount(accountId);
  } else {
    for (const auto of automations || []) {
      recipients.push(...(await db.listRecipients(auto.id)));
    }
  }
  for (const rec of recipients) {
    const draft = recipientToLeadDraft(rec, { accountId });
    const found = (draft.comment_id && byComment.get(String(draft.comment_id)))
      || (draft.recipient_id && byRecipient.get(Number(draft.recipient_id)));
    if (found) {
      const fields = { ...parseLeadFields(found.fields), ...draft.fields };
      const patch = {
        recipient_id: found.recipient_id || draft.recipient_id,
        automation_id: found.automation_id || draft.automation_id,
        username: found.username || draft.username,
        igsid: found.igsid || draft.igsid,
        fields,
      };
      // Do not downgrade a manually set terminal status.
      if (!['converted', 'closed', 'ignored'].includes(found.status)) {
        patch.status = draft.status;
      }
      await db.updateLead(found.id, patch);
    } else {
      await db.createLead(draft);
    }
  }
  return db.listLeads(accountId);
}

async function collectAutomationAudits({ db, instagram, account, automations, now, errors }) {
  const audits = {};
  await Promise.all((automations || []).map(async (auto) => {
    if (!auto || !auto.media_id) return;
    try {
      const raw = await collectAutomationAudit(instagram, account, auto, {
        now,
        includeConversations: false,
      });
      if (!raw || !raw.ok) {
        if (raw && (raw.message || raw.error)) {
          errors.push({ label: 'audit.' + auto.id, message: raw.message || raw.error, code: raw.error || null });
        }
        return;
      }
      const tagged = db ? await attachRecipientFlags(db, account, raw) : raw;
      audits[auto.id] = tagged;
      audits[String(auto.id)] = tagged;
    } catch (err) {
      errors.push({ label: 'audit.' + auto.id, message: err.message });
    }
  }));
  return audits;
}

async function collectInsights({ db, instagram, account, days = 30, now = new Date() } = {}) {
  const window = periodWindow(days, now);
  const errors = [];

  const mediaPromise = safeCall(() => instagram.listMedia(account), 'listMedia', errors);
  const insightsCurrentPromise = instagram.getAccountInsights
    ? safeCall(
      () => instagram.getAccountInsights(account, {
        since: unixSeconds(window.since),
        until: unixSeconds(window.until),
      }),
      'accountInsights.current',
      errors
    )
    : Promise.resolve(null);
  const insightsPreviousPromise = instagram.getAccountInsights
    ? safeCall(
      () => instagram.getAccountInsights(account, {
        since: unixSeconds(window.prevSince),
        until: unixSeconds(window.prevUntil),
      }),
      'accountInsights.previous',
      errors
    )
    : Promise.resolve(null);
  const profilePromise = instagram.getAccountProfile
    ? safeCall(() => instagram.getAccountProfile(account), 'accountProfile', errors)
    : Promise.resolve(null);
  const automationsPromise = db.listAutomations(account.id);

  const [mediaResult, insightsCurrent, insightsPrevious, profile, automations] = await Promise.all([
    mediaPromise,
    insightsCurrentPromise,
    insightsPreviousPromise,
    profilePromise,
    automationsPromise,
  ]);
  const media = mediaResult || [];

  let trends = computeMediaTrends(media, days, now);
  if (insightsCurrent) {
    const followersNow = profile?.followers_count;
    let followersPrev = null;
    if (followersNow != null && trends.deltas?.engagement != null) {
      // If follower_count time series is present, prefer it; else leave previous unknown.
    }
    const curParsedFollowers = insightsCurrent;
    trends = mergeAccountInsights(
      trends,
      insightsCurrent,
      insightsPrevious || {},
      followersNow ?? null,
      followersPrev
    );
    // If follower insight series exists, apply growth from it
    const { parseGraphInsights, sumInsightValues } = require('../lib/insights');
    const cur = parseGraphInsights(insightsCurrent);
    if (cur.follower_count) {
      const values = cur.follower_count.values || [];
      const last = values.length ? values[values.length - 1].value : sumInsightValues(cur.follower_count);
      const first = values.length ? values[0].value : null;
      trends.followers = {
        current: last || followersNow || null,
        previous: first,
        growth: first != null && last != null ? last - first : trends.followers?.growth,
        delta: first ? Math.round(((last - first) / Math.abs(first)) * 1000) / 10 : trends.followers?.delta,
      };
    } else if (followersNow != null && !trends.followers?.current) {
      trends.followers = { current: Number(followersNow), previous: null, growth: null, delta: null };
    }
    void curParsedFollowers;
  } else if (profile?.followers_count != null) {
    trends.followers = {
      current: Number(profile.followers_count),
      previous: null,
      growth: null,
      delta: null,
    };
  }

  const works = whatWorks(media, days, now);

  const leads = await syncLeadsFromRecipients(db, account.id, automations);
  let recipients = [];
  if (typeof db.listRecipientsByAccount === 'function') {
    recipients = await db.listRecipientsByAccount(account.id);
  } else {
    for (const auto of automations || []) {
      recipients.push(...(await db.listRecipients(auto.id)));
    }
  }
  const audits = await collectAutomationAudits({ db, instagram, account, automations, now, errors });
  const funnels = buildFunnels(automations, { recipients, leads, audits });
  const comments = [];
  for (const r of recipients) comments.push({ text: r.comment_text, comment_text: r.comment_text });
  for (const audit of Object.values(audits)) {
    for (const item of audit.items || []) {
      if (item.comment_text) comments.push({ text: item.comment_text, comment_text: item.comment_text });
    }
  }
  const recommendations = generateRecommendations({
    media,
    automations,
    comments,
    trends,
    what_works: works,
    now,
  });

  let weekly = null;
  if (typeof db.getLatestWeeklySummary === 'function') {
    weekly = await db.getLatestWeeklySummary(account.id);
    if (weekly && weekly.points && typeof weekly.points === 'string') {
      try { weekly.points = JSON.parse(weekly.points); } catch { /* keep raw */ }
    }
  }

  const insightsAvailable = !!trends.insights_available;
  return {
    period_days: Number(days) || 30,
    generated_at: now.toISOString(),
    insights_available: insightsAvailable,
    note: insightsAvailable ? null : FALLBACK_NOTE,
    errors,
    trends,
    what_works: works,
    recommendations,
    funnels,
    weekly_summary: weekly,
    follower_count: trends.followers?.current ?? profile?.followers_count ?? null,
  };
}

async function buildAccountWeeklySummary({ db, instagram, account, now = new Date() } = {}) {
  const data = await collectInsights({ db, instagram, account, days: 7, now });
  return buildWeeklySummary({
    trends: data.trends,
    what_works: data.what_works,
    recommendations: data.recommendations,
    now,
  });
}

module.exports = {
  FALLBACK_NOTE,
  collectInsights,
  syncLeadsFromRecipients,
  buildAccountWeeklySummary,
};
