const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const { createAuthRouter, createSessionMiddleware } = require('./routes/auth');
const { createWebhookRouter } = require('./routes/webhooks');
const { createApiRouter } = require('./routes/api');
const { createRedirectRouter } = require('./routes/redirect');
const { createLegalRouter } = require('./routes/legal');

function createApp({ db, config, instagram, engine }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  // Raw body needed for X-Hub-Signature-256 on the webhook path only.
  app.use(
    '/webhook',
    express.json({
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      },
    })
  );
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  // Render health checks hit this path (also available at /api/health).
  app.get('/health', (_req, res) => {
    res.json({ ok: true, mockMode: config.mockMode, authMode: config.authMode, time: new Date().toISOString() });
  });

  app.use(createSessionMiddleware({ db, config }));

  app.use('/webhook', createWebhookRouter({ db, config, engine }));
  const auth = createAuthRouter({ db, config, instagram });
  app.use('/auth', auth.router);
  app.use('/api', createApiRouter({ db, config, instagram, engine }));
  app.use('/r', createRedirectRouter({ db }));
  app.use(createLegalRouter({ db, config }));

  const publicDir = path.join(__dirname, 'public');
  app.use(express.static(publicDir, { extensions: ['html'] }));
  app.get('*', (req, res, next) => {
    if (req.path === '/health' || req.path.startsWith('/api') || req.path.startsWith('/auth') || req.path.startsWith('/webhook') || req.path.startsWith('/r/')) {
      return next();
    }
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  app.use((err, _req, res, _next) => {
    console.error('[app]', err);
    res.status(500).json({ error: err.message || 'server_error' });
  });

  return app;
}

module.exports = { createApp };
