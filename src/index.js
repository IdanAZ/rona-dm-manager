const config = require('./config');
const { createDb } = require('./db');
const { createInstagramClient, refreshDueTokens } = require('./services/instagram');
const { createEngine } = require('./services/engine');
const { createApp } = require('./app');
const { startCommentPoller } = require('./services/commentPoller');
const { startWeeklySummaryJob } = require('./services/weeklySummary');

async function main() {
  const db = await createDb(process.env.DATABASE_URL || config.dbPath);
  const instagram = createInstagramClient({ config, db });
  const engine = createEngine({ db, instagram, config });
  const app = createApp({ db, config, instagram, engine });

  const server = app.listen(config.port, config.host, () => {
    console.log(`Rona Insta listening on http://${config.host}:${config.port}`);
    console.log(`Mode: ${config.mockMode ? 'MOCK / development' : 'LIVE'}`);
    console.log(`Public URL: ${config.appUrl}`);
  });

  // Periodic token refresh (long-lived tokens last 60 days; refresh after 24h).
  const refreshTimer = setInterval(() => {
    refreshDueTokens({ config, db, instagram }).catch((err) =>
      console.warn('[token-refresh]', err.message)
    );
  }, 12 * 3600 * 1000);

  const followupTimer = setInterval(() => {
    engine.processFollowups().catch((err) => console.warn('[followups]', err.message));
  }, config.followupIntervalMs);

  const pollTimer = setInterval(async () => {
    try {
      const accounts = await db.listAccountsWithTokens();
      for (const acc of accounts) {
        const media = await instagram.listMedia(acc);
        await engine.bindNewMedia(acc, media);
      }
    } catch (err) {
      console.warn('[media-poll]', err.message);
    }
  }, config.pollIntervalMs);

  const commentPoller = startCommentPoller({ db, instagram, engine, config });
  const weeklyJob = startWeeklySummaryJob({ db, instagram, config });

  function shutdown() {
    clearInterval(refreshTimer);
    clearInterval(followupTimer);
    clearInterval(pollTimer);
    if (commentPoller && commentPoller.stop) commentPoller.stop();
    if (weeklyJob && weeklyJob.stop) weeklyJob.stop();
    server.close(async () => {
      try { await db.close(); } catch {}
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 3000).unref();
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return { server, db, app };
}

// Allow tests to import without listening
if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { main };
