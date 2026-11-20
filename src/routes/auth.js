const express = require('express');
const { randomId, signCookie } = require('../lib/signatures');
const { expiresAtFromSeconds } = require('../services/instagram');
const { seedDemoAutomation } = require('../services/seed');

const COOKIE = 'rona_sid';
const PENDING_COOKIE = 'rona_pending';

function cookieOptions(config, maxAgeMs) {
  const secure = config.appUrl.startsWith('https://');
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: maxAgeMs,
  };
}

function expiresInDays(days) {
  return new Date(Date.now() + days * 24 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);
}

function publicAccount(acc) {
  if (!acc) return null;
  return {
    id: acc.id,
    ig_user_id: acc.ig_user_id,
    username: acc.username,
    name: acc.name,
    profile_picture_url: acc.profile_picture_url,
    account_type: acc.account_type,
    token_expires_at: acc.token_expires_at,
    page_id: acc.page_id,
    page_name: acc.page_name,
    auth_mode: acc.auth_mode,
    connected: !!acc.access_token || !!acc.page_access_token || acc.ig_user_id?.startsWith('mock_'),
  };
}

function createAuthRouter({ db, config, instagram }) {
  const router = express.Router();

  async function startSession(res, { userId, accountId }) {
    const sid = randomId(24);
    await db.createSession({
      id: sid,
      userId,
      activeAccountId: accountId,
      expiresAt: expiresInDays(config.sessionTtlDays),
    });
    res.cookie(COOKIE, signCookie(sid, config.sessionSecret), cookieOptions(config, config.sessionTtlDays * 864e5));
    return sid;
  }

  async function startOAuth(req, res, mode) {
    if (config.mockMode) {
      return res.redirect('/?need_mock_login=1');
    }
    if (!config.meta.appId) {
      return res.status(400).send('חסר META_APP_ID. ראו את קובץ .env.example');
    }
    if (mode === 'facebook' && !config.meta.configId && !config.meta.scopes.length) {
      return res.status(400).send('חסר META_CONFIG_ID (מזהה התצורה של Facebook Login for Business).');
    }
    const state = randomId(16);
    const intent = req.query.add === '1' && req.user ? 'add_account' : 'login';
    await db.saveOauthState({
      state,
      userId: intent === 'add_account' ? req.user.id : null,
      intent,
      expiresAt: expiresInDays(1 / 24),
    });
    const redirectUri = mode === 'instagram' ? instagram.instagramRedirectUri() : instagram.facebookRedirectUri();
    res.redirect(instagram.authorizationUrl({ state, redirectUri, mode }));
  }

  async function persistLinkedAccount({ userId, linked, tokens, permissions }) {
    const pageToken = linked.pageAccessToken || null;
    const apiTok = pageToken || tokens.userToken;
    return await db.upsertAccount({
      userId,
      igUserId: linked.igUserId,
      username: linked.username,
      name: linked.name,
      profilePictureUrl: linked.profilePictureUrl,
      accountType: linked.accountType,
      accessToken: apiTok,
      tokenExpiresAt: pageToken ? null : tokens.userTokenExpiresAt,
      permissions: permissions || '',
      pageId: linked.pageId,
      pageName: linked.pageName,
      pageAccessToken: pageToken,
      fbUserId: tokens.fbUserId,
      fbUserToken: tokens.userToken,
      fbUserTokenExpiresAt: tokens.userTokenExpiresAt,
      clientBusinessId: tokens.clientBusinessId,
      authMode: 'facebook',
      tokenKind: linked.tokenKind || (pageToken ? 'page' : 'system_user'),
    });
  }

  async function finishFacebookLogin(req, res, saved, linkedList, tokens, permissions) {
    if (!linkedList.length) {
      return res.redirect(
        `/?auth_error=${encodeURIComponent('לא נמצא חשבון אינסטגרם מקצועי מקושר לעמוד פייסבוק. ודאו שהחשבון מחובר לעמוד (למשל rona_menahimov).')}`
      );
    }

    const pickUserId = async () => {
      if (saved.intent === 'add_account' && saved.user_id) return saved.user_id;
      for (const linked of linkedList) {
        const existing = await db.getAccountByIgUserId(linked.igUserId);
        if (existing) return existing.user_id;
      }
      return await db.createUser();
    };

    if (linkedList.length === 1) {
      const linked = linkedList[0];
      const existing = await db.getAccountByIgUserId(linked.igUserId);
      if (saved.intent === 'add_account' && saved.user_id && existing && existing.user_id !== saved.user_id) {
        return res.redirect(`/?auth_error=${encodeURIComponent('החשבון הזה כבר מחובר למשתמש אחר')}`);
      }
      const userId = saved.intent === 'add_account' && saved.user_id ? saved.user_id : (existing ? existing.user_id : await db.createUser());
      const account = await persistLinkedAccount({ userId, linked, tokens, permissions });
      instagram.subscribeWebhooks(account).catch((err) => console.warn('[subscribe]', err.message));
      await startSession(res, { userId, accountId: account.id });
      return res.redirect('/');
    }

    const userId = await pickUserId();
    const pendingId = randomId(16);
    await db.savePendingConnection({
      id: pendingId,
      userId,
      intent: saved.intent,
      payload: { linkedList, tokens, permissions },
      expiresAt: expiresInDays(1 / 24),
    });
    await startSession(res, { userId, accountId: null });
    res.cookie(PENDING_COOKIE, pendingId, cookieOptions(config, 3600 * 1000));
    return res.redirect('/?pick_account=1');
  }

  router.get('/login', (req, res, next) => startOAuth(req, res, config.authMode || 'facebook').catch(next));
  router.get('/facebook', (req, res, next) => startOAuth(req, res, 'facebook').catch(next));
  router.get('/instagram', (req, res, next) => startOAuth(req, res, config.authMode === 'instagram' ? 'instagram' : 'facebook').catch(next));

  router.get('/facebook/callback', async (req, res) => {
    try {
      const { code, state, error, error_description: errDesc, error_reason: errReason } = req.query;
      if (error) {
        return res.redirect(`/?auth_error=${encodeURIComponent(errDesc || errReason || error)}`);
      }
      const saved = state ? await db.consumeOauthState(String(state)) : null;
      if (!saved) {
        return res.redirect(`/?auth_error=${encodeURIComponent('פג תוקף החיבור, נסו שוב')}`);
      }
      const redirectUri = instagram.facebookRedirectUri();
      const short = await instagram.exchangeCode(String(code || ''), redirectUri, 'facebook');
      const longLived = await instagram.exchangeLongLived(short.accessToken, 'facebook');
      const discovered = await instagram.listLinkedInstagramAccounts(longLived.accessToken);
      const tokens = {
        userToken: longLived.accessToken,
        userTokenExpiresAt: expiresAtFromSeconds(longLived.expiresIn),
        fbUserId: discovered.fbUserId || short.userId,
        clientBusinessId: discovered.clientBusinessId,
      };
      await finishFacebookLogin(req, res, saved, discovered.accounts, tokens, short.permissions || '');
    } catch (err) {
      console.error('[oauth-facebook-callback]', err);
      res.redirect(`/?auth_error=${encodeURIComponent(err.message || 'שגיאה בהתחברות')}`);
    }
  });

  router.get('/instagram/callback', async (req, res) => {
    try {
      const { code, state, error, error_description: errDesc } = req.query;
      if (error) {
        return res.redirect(`/?auth_error=${encodeURIComponent(errDesc || error)}`);
      }
      const saved = state ? await db.consumeOauthState(String(state)) : null;
      if (!saved) {
        return res.redirect(`/?auth_error=${encodeURIComponent('פג תוקף החיבור, נסו שוב')}`);
      }
      const redirectUri = instagram.instagramRedirectUri();
      const short = await instagram.exchangeCode(String(code || ''), redirectUri, 'instagram');
      const longLived = await instagram.exchangeLongLived(short.accessToken, 'instagram');
      const me = await instagram.getMe(longLived.accessToken, 'instagram');
      const existing = await db.getAccountByIgUserId(me.id);

      let userId;
      if (saved.intent === 'add_account' && saved.user_id) {
        if (existing && existing.user_id !== saved.user_id) {
          return res.redirect(`/?auth_error=${encodeURIComponent('החשבון הזה כבר מחובר למשתמש אחר')}`);
        }
        userId = saved.user_id;
      } else if (existing) {
        userId = existing.user_id;
      } else {
        userId = await db.createUser();
      }

      const account = await db.upsertAccount({
        userId,
        igUserId: me.id,
        username: me.username,
        name: me.name,
        profilePictureUrl: me.profile_picture_url,
        accountType: me.account_type,
        accessToken: longLived.accessToken,
        tokenExpiresAt: expiresAtFromSeconds(longLived.expiresIn),
        permissions: short.permissions || '',
        authMode: 'instagram',
        tokenKind: 'ig_user',
      });
      instagram.subscribeWebhooks(account).catch((err) => console.warn('[subscribe]', err.message));
      await startSession(res, { userId, accountId: account.id });
      res.redirect('/');
    } catch (err) {
      console.error('[oauth-instagram-callback]', err);
      res.redirect(`/?auth_error=${encodeURIComponent(err.message || 'שגיאה בהתחברות')}`);
    }
  });

  router.get('/pending', async (req, res, next) => {
    try {
    const id = req.cookies?.[PENDING_COOKIE];
    if (!id) return res.json({ pending: null });
    const row = await db.getPendingConnection(id);
    if (!row) {
      res.clearCookie(PENDING_COOKIE, { path: '/' });
      return res.json({ pending: null });
    }
    const payload = JSON.parse(row.payload);
    res.json({
      pending: {
        id,
        accounts: (payload.linkedList || []).map((a) => ({
          igUserId: a.igUserId,
          username: a.username,
          name: a.name,
          pageId: a.pageId,
          pageName: a.pageName,
          profilePictureUrl: a.profilePictureUrl,
        })),
      },
    });
    } catch (err) { next(err); }
  });

  router.post('/pending/select', async (req, res, next) => {
    try {
    const id = req.cookies?.[PENDING_COOKIE];
    if (!id) return res.status(400).json({ error: 'no_pending' });
    const row = await db.getPendingConnection(id);
    if (!row) return res.status(400).json({ error: 'pending_expired' });
    const payload = JSON.parse(row.payload);
    const igUserId = String(req.body?.ig_user_id || '');
    const linked = (payload.linkedList || []).find((a) => String(a.igUserId) === igUserId);
    if (!linked) return res.status(404).json({ error: 'account_not_found' });
    const existing = await db.getAccountByIgUserId(linked.igUserId);
    if (existing && existing.user_id !== row.user_id) {
      return res.status(409).json({ error: 'account_owned_by_other_user' });
    }
    const account = await persistLinkedAccount({
      userId: row.user_id,
      linked,
      tokens: payload.tokens,
      permissions: payload.permissions,
    });
    instagram.subscribeWebhooks(account).catch((err) => console.warn('[subscribe]', err.message));
    if (req.sessionId) await db.setActiveAccount(req.sessionId, account.id);
    await db.deletePendingConnection(id);
    res.clearCookie(PENDING_COOKIE, { path: '/' });
    res.json({ ok: true, account: publicAccount(account) });
    } catch (err) { next(err); }
  });

  router.post('/logout', async (req, res, next) => {
    try {
    if (req.sessionId) await db.deleteSession(req.sessionId);
    res.clearCookie(COOKIE, { path: '/' });
    res.clearCookie(PENDING_COOKIE, { path: '/' });
    res.json({ ok: true });
    } catch (err) { next(err); }
  });

  router.post('/mock-login', async (req, res, next) => {
    try {
    if (!config.mockMode) {
      return res.status(403).json({ error: 'מצב הדגמה כבוי' });
    }
    const username = String(req.body?.username || 'rona_demo').replace(/^@/, '') || 'rona_demo';
    const igUserId = `mock_ig_${username}`;
    let account = await db.getAccountByIgUserId(igUserId);
    let userId;
    if (account) {
      userId = account.user_id;
    } else {
      userId = await db.createUser();
      account = await db.upsertAccount({
        userId,
        igUserId,
        username,
        name: username === 'rona_demo' ? 'רונה' : username,
        profilePictureUrl: '',
        accountType: 'MEDIA_CREATOR',
        accessToken: 'mock-token',
        tokenExpiresAt: expiresInDays(60),
        permissions: config.meta.scopes.join(','),
        authMode: 'mock',
        tokenKind: 'mock',
      });
    }
    await startSession(res, { userId, accountId: account.id });
    if (username === 'rona_demo') await seedDemoAutomation(db, account.id);
    res.json({ ok: true, account: publicAccount(account) });
    } catch (err) { next(err); }
  });

  router.get('/me', async (req, res, next) => {
    try {
    if (!req.user) return res.status(401).json({ error: 'not_logged_in' });
    const accounts = (await db.listAccountsForUser(req.user.id)).map(publicAccount);
    res.json({
      user: { id: req.user.id },
      account: publicAccount(req.account),
      accounts,
      mockMode: config.mockMode,
      authMode: config.authMode,
    });
    } catch (err) { next(err); }
  });

  return { router, startSession, publicAccount, COOKIE, cookieOptions };
}

function createSessionMiddleware({ db, config }) {
  const { unsignCookie } = require('../lib/signatures');
  return async function sessionMiddleware(req, res, next) {
    try {
      req.user = null;
      req.account = null;
      req.sessionId = null;
      req.sessionRow = null;
      const raw = req.cookies?.[COOKIE];
      const sid = raw ? unsignCookie(raw, config.sessionSecret) : null;
      if (sid) {
        const row = await db.getSession(sid);
        if (row && Date.parse(String(row.expires_at).replace(' ', 'T') + 'Z') > Date.now()) {
          const user = await db.getUser(row.user_id);
          if (user) {
            req.sessionId = sid;
            req.sessionRow = row;
            req.user = user;
            const accounts = await db.listAccountsForUser(user.id);
            req.account =
              (row.active_account_id && accounts.find((a) => a.id === row.active_account_id)) ||
              accounts[0] ||
              null;
          }
        }
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'not_logged_in' });
  next();
}

function requireAccount(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'not_logged_in' });
  if (!req.account) return res.status(400).json({ error: 'no_account' });
  next();
}

module.exports = {
  createAuthRouter,
  createSessionMiddleware,
  requireAuth,
  requireAccount,
  publicAccount,
  COOKIE,
};
