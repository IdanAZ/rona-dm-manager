const { isSundayNineJerusalem, weekStartSundayJerusalem, jerusalemParts } = require('../lib/time');
const { renderSummaryEmail } = require('../lib/insights');
const { buildAccountWeeklySummary } = require('./insights');
const { emailConfigured, sendEmail } = require('../lib/email');

async function upsertAndMaybeEmail({ db, instagram, account, config, now, transport, force = false }) {
  const weekStart = weekStartSundayJerusalem(now);
  if (!force && typeof db.getWeeklySummary === 'function') {
    const existing = await db.getWeeklySummary(account.id, weekStart);
    if (existing) return { skipped: true, reason: 'already_generated', summary: existing };
  }
  const built = await buildAccountWeeklySummary({ db, instagram, account, now });
  const saved = await db.upsertWeeklySummary({
    accountId: account.id,
    weekStart: built.week_start,
    body: built.body,
    points: built.points,
  });

  let email = { skipped: true, reason: 'email_not_configured' };
  if (emailConfigured(config)) {
    const message = renderSummaryEmail({
      accountName: account.name,
      username: account.username,
      summary: built,
    });
    try {
      email = await sendEmail(config, message, transport);
      if (!email.skipped && saved?.id && db.markWeeklySummaryEmailed) {
        await db.markWeeklySummaryEmailed(saved.id, now);
      }
    } catch (err) {
      email = { ok: false, error: err.message };
      console.warn('[weekly-summary] email failed:', err.message);
    }
  }
  return { skipped: false, summary: saved || built, email };
}

async function runWeeklySummaries({ db, instagram, config, now = new Date(), transport, force = false } = {}) {
  const accounts = (await db.listAccountsWithTokens()) || [];
  const results = [];
  for (const account of accounts) {
    try {
      const result = await upsertAndMaybeEmail({ db, instagram, account, config, now, transport, force });
      results.push({ account_id: account.id, username: account.username, ok: true, ...result });
    } catch (err) {
      console.warn('[weekly-summary] account', account.id, err.message);
      results.push({ account_id: account.id, ok: false, error: err.message });
    }
  }
  return results;
}

function startWeeklySummaryJob({ db, instagram, config, intervalMs = 30000 } = {}) {
  let lastRunKey = '';
  const tick = async (now = new Date()) => {
    const parts = jerusalemParts(now);
    if (!isSundayNineJerusalem(now)) return null;
    const key = `${parts.dateStr}-09`;
    if (key === lastRunKey) return null;
    lastRunKey = key;
    console.log('[weekly-summary] Sunday 09:00 Asia/Jerusalem — generating summaries');
    try {
      return await runWeeklySummaries({ db, instagram, config, now });
    } catch (err) {
      console.warn('[weekly-summary] job failed:', err.message);
      return null;
    }
  };
  const timer = setInterval(() => {
    tick().catch((err) => console.warn('[weekly-summary]', err.message));
  }, intervalMs);
  if (timer.unref) timer.unref();
  return {
    tick,
    stop() { clearInterval(timer); },
  };
}

module.exports = { runWeeklySummaries, startWeeklySummaryJob, upsertAndMaybeEmail };
