const { randomId } = require('../lib/signatures');

const MOCK_MEDIA = [
  {
    id: 'mock_media_reel_cake',
    caption: 'הכנה של העוגה האהובה 🍰 שמרו לכם!',
    media_type: 'VIDEO',
    media_product_type: 'REELS',
    media_url: 'https://placehold.co/800x1000/f8c8d8/4a1c2b?text=Reel',
    thumbnail_url: 'https://placehold.co/800x1000/f8c8d8/4a1c2b?text=Reel',
    permalink: 'https://www.instagram.com/reel/mock_cake/',
    timestamp: '2026-11-18T10:00:00+0000',
    like_count: 128,
    comments_count: 24,
  },
  {
    id: 'mock_media_post_salad',
    caption: 'מה אתן שמות לזה? 🥗 כתבו לי בתגובות',
    media_type: 'IMAGE',
    media_product_type: 'FEED',
    media_url: 'https://placehold.co/800x800/d8f0e0/1c3a2a?text=Post',
    thumbnail_url: 'https://placehold.co/800x800/d8f0e0/1c3a2a?text=Post',
    permalink: 'https://www.instagram.com/p/mock_salad/',
    timestamp: '2026-11-15T16:30:00+0000',
    like_count: 86,
    comments_count: 19,
  },
  {
    id: 'mock_media_reel_morning',
    caption: 'שגרת בוקר קלילה ☀️',
    media_type: 'VIDEO',
    media_product_type: 'REELS',
    media_url: 'https://placehold.co/800x1000/ffe6c8/5a3a10?text=Morning',
    thumbnail_url: 'https://placehold.co/800x1000/ffe6c8/5a3a10?text=Morning',
    permalink: 'https://www.instagram.com/reel/mock_morning/',
    timestamp: '2026-11-12T07:15:00+0000',
    like_count: 204,
    comments_count: 41,
  },
  {
    id: 'mock_media_reel_course',
    caption: 'קורס הכנה ללידה — מה באמת עושים במפגשים? כתבו "קורס" ואשלח פרטים 💗',
    media_type: 'VIDEO',
    media_product_type: 'REELS',
    media_url: 'https://placehold.co/800x1000/f3d0d8/5a2434?text=Course',
    thumbnail_url: 'https://placehold.co/800x1000/f3d0d8/5a2434?text=Course',
    permalink: 'https://www.instagram.com/reel/mock_course/',
    timestamp: '2026-11-19T18:00:00+0000',
    like_count: 312,
    comments_count: 67,
  },
  {
    id: 'mock_media_carousel_bag',
    caption: 'מה לשים בתיק ללידה? קרוסלה עם הרשימה המלאה 👜',
    media_type: 'CAROUSEL_ALBUM',
    media_product_type: 'FEED',
    media_url: 'https://placehold.co/800x800/ead9c8/4a3428?text=Bag',
    thumbnail_url: 'https://placehold.co/800x800/ead9c8/4a3428?text=Bag',
    permalink: 'https://www.instagram.com/p/mock_bag/',
    timestamp: '2026-11-16T19:30:00+0000',
    like_count: 188,
    comments_count: 29,
  },
  {
    id: 'mock_media_image_breath',
    caption: 'תרגיל נשימה קצר לרגע של לחץ בהריון. שמרו לכן 🌿',
    media_type: 'IMAGE',
    media_product_type: 'FEED',
    media_url: 'https://placehold.co/800x800/dce8dc/2a3c2a?text=Breath',
    thumbnail_url: 'https://placehold.co/800x800/dce8dc/2a3c2a?text=Breath',
    permalink: 'https://www.instagram.com/p/mock_breath/',
    timestamp: '2026-11-11T08:00:00+0000',
    like_count: 94,
    comments_count: 11,
  },
  {
    id: 'mock_media_reel_qa',
    caption: 'שאלות שאתן שואלות אותי שוב ושוב לפני הלידה ✨',
    media_type: 'VIDEO',
    media_product_type: 'REELS',
    media_url: 'https://placehold.co/800x1000/e8d5f0/3a2048?text=Q%26A',
    thumbnail_url: 'https://placehold.co/800x1000/e8d5f0/3a2048?text=Q%26A',
    permalink: 'https://www.instagram.com/reel/mock_qa/',
    timestamp: '2026-11-08T17:45:00+0000',
    like_count: 267,
    comments_count: 52,
  },
  {
    id: 'mock_media_carousel_stages',
    caption: 'שלושת שלבי הלידה, בשפה פשוטה. כרטיסיה 2 הכי חשובה 🫶',
    media_type: 'CAROUSEL_ALBUM',
    media_product_type: 'FEED',
    media_url: 'https://placehold.co/800x800/f6e4c8/4a3418?text=Stages',
    thumbnail_url: 'https://placehold.co/800x800/f6e4c8/4a3418?text=Stages',
    permalink: 'https://www.instagram.com/p/mock_stages/',
    timestamp: '2026-11-04T16:15:00+0000',
    like_count: 143,
    comments_count: 22,
  },
  {
    id: 'mock_media_reel_partner',
    caption: 'איך בן או בת הזוג יכולים באמת לעזור בלידה',
    media_type: 'VIDEO',
    media_product_type: 'REELS',
    media_url: 'https://placehold.co/800x1000/d8e4f0/203048?text=Partner',
    thumbnail_url: 'https://placehold.co/800x1000/d8e4f0/203048?text=Partner',
    permalink: 'https://www.instagram.com/reel/mock_partner/',
    timestamp: '2026-10-29T18:20:00+0000',
    like_count: 221,
    comments_count: 38,
  },
  {
    id: 'mock_media_image_quote',
    caption: 'את לא צריכה להיות רגועה. את צריכה להיות מלווה.',
    media_type: 'IMAGE',
    media_product_type: 'FEED',
    media_url: 'https://placehold.co/800x800/f0e4dc/4a3028?text=Quote',
    thumbnail_url: 'https://placehold.co/800x800/f0e4dc/4a3028?text=Quote',
    permalink: 'https://www.instagram.com/p/mock_quote/',
    timestamp: '2026-10-22T09:10:00+0000',
    like_count: 76,
    comments_count: 7,
  },
];

function accountAuthMode(config, account) {
  return account?.auth_mode || config.authMode || 'facebook';
}

function graphHost(config, account) {
  return accountAuthMode(config, account) === 'instagram' ? 'graph.instagram.com' : 'graph.facebook.com';
}

function graphUrl(config, pathname, params, account) {
  const u = new URL(`https://${graphHost(config, account)}/${config.meta.apiVersion}${pathname}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) u.searchParams.set(k, v);
    }
  }
  return u.toString();
}

function apiToken(account) {
  return account?.page_access_token || account?.access_token;
}

function messagesPath(account) {
  if (account?.page_id) return `/${account.page_id}/messages`;
  return `/${account.ig_user_id}/messages`;
}

const GRAPH_TIMEOUT_MS = 10000;

function graphAbortSignal(ms) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms);
  }
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  if (typeof t.unref === 'function') t.unref();
  return controller.signal;
}

async function graphFetch(url, { method = 'GET', token, body, timeoutMs = GRAPH_TIMEOUT_MS } = {}) {
  const headers = { Authorization: `Bearer ${token}` };
  let payload;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(url, { method, headers, body: payload, signal: graphAbortSignal(timeoutMs) });
  } catch (err) {
    if (err && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
      const timeout = new Error(`Graph API timeout after ${timeoutMs}ms`);
      timeout.status = 504;
      timeout.code = 'graph_timeout';
      throw timeout;
    }
    throw err;
  }
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(json?.error?.message || `Graph API ${res.status}`);
    err.status = res.status;
    err.payload = json;
    throw err;
  }
  return json;
}


async function graphPaginate(url, { token, maxPages = 30, maxItems = 2000 } = {}) {
  const items = [];
  let next = url;
  let pages = 0;
  while (next && pages < maxPages && items.length < maxItems) {
    const json = await graphFetch(next, { token });
    items.push(...(json.data || []));
    next = json.paging && json.paging.next ? json.paging.next : null;
    pages += 1;
  }
  return items;
}

function graphErrorInfo(endpoint, err) {
  const payload = err?.payload?.error || err?.payload || null;
  return {
    endpoint,
    message: err.message,
    status: err.status || null,
    code: payload?.code ?? null,
    error_subcode: payload?.error_subcode ?? null,
    type: payload?.type ?? null,
    fbtrace_id: payload?.fbtrace_id ?? null,
  };
}

const MEDIA_FIELDS =
  'id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count';

const MOCK_AUDIT_MEDIA = {
  id: 'mock_media_hakana',
  caption: 'הגיבי ״הכנה״ ואשלח לך את כל הפרטים❤️',
  media_type: 'VIDEO',
  media_product_type: 'REELS',
  permalink: 'https://www.instagram.com/reel/mock_hakana/',
  thumbnail_url: 'https://placehold.co/800x1000/f8c8d8/4a1c2b?text=Hakana',
  timestamp: '2026-11-10T10:00:00+0000',
  comments_count: 3,
};

const MOCK_AUDIT_COMMENTS = [
  {
    id: 'mock_c_dana',
    text: 'הכנה❤️',
    username: 'dana_got_auto',
    timestamp: '2026-11-19T08:00:00+0000',
    from: { id: 'id_dana', username: 'dana_got_auto' },
    parent_id: null,
    replies: [
      {
        id: 'mock_r_dana',
        text: 'שלחתי לך הודעה בפרטי ❤️',
        username: 'rona_demo',
        timestamp: '2026-11-19T08:01:00+0000',
        from: { id: 'mock_ig_rona_demo', username: 'rona_demo' },
      },
    ],
  },
  {
    id: 'mock_c_tamar',
    text: 'הכנה',
    username: 'tamar_eligible',
    timestamp: '2026-11-19T20:00:00+0000',
    from: { id: 'id_tamar', username: 'tamar_eligible' },
    parent_id: null,
    replies: [],
  },
  {
    id: 'mock_c_shira',
    text: '״הכנה״',
    username: 'shira_old',
    timestamp: '2026-10-01T10:00:00+0000',
    from: { id: 'id_shira', username: 'shira_old' },
    parent_id: null,
    replies: [],
  },
];

const MOCK_AUDIT_CONVERSATIONS = [
  {
    id: 'mock_conv_dana',
    participants: {
      data: [
        { id: 'id_dana', username: 'dana_got_auto' },
        { id: 'mock_ig_rona_demo', username: 'rona_demo' },
      ],
    },
    messages: [
      {
        id: 'mock_m1',
        created_time: '2026-11-19T08:01:30+0000',
        from: { id: 'mock_ig_rona_demo', username: 'rona_demo' },
        message: 'היי! שמחה שאהבת 😊 רוצה שאשלח לך את הפרטים?',
      },
    ],
  },
];

function facebookRedirectUri(config) {
  return `${config.appUrl}/auth/facebook/callback`;
}

function instagramRedirectUri(config) {
  return `${config.appUrl}/auth/instagram/callback`;
}

function createInstagramClient({ config, db }) {
  const mock = !!config.mockMode;

  async function withAccount(account, fn, mockResult) {
    if (mock) return mockResult();
    if (!apiToken(account)) {
      throw new Error('לחשבון אין אסימון גישה. התחברו מחדש.');
    }
    return fn(account);
  }

  return {
    isMock: mock,
    mockMedia: MOCK_MEDIA,
    facebookRedirectUri: () => facebookRedirectUri(config),
    instagramRedirectUri: () => instagramRedirectUri(config),

    authorizationUrl({ state, redirectUri, mode }) {
      const m = mode || config.authMode || 'facebook';
      if (m === 'instagram') {
        const u = new URL('https://www.instagram.com/oauth/authorize');
        u.searchParams.set('client_id', config.meta.appId);
        u.searchParams.set('redirect_uri', redirectUri || instagramRedirectUri(config));
        u.searchParams.set('response_type', 'code');
        u.searchParams.set('scope', config.meta.scopes.join(','));
        u.searchParams.set('state', state);
        return u.toString();
      }
      const u = new URL(`https://www.facebook.com/${config.meta.apiVersion}/dialog/oauth`);
      u.searchParams.set('client_id', config.meta.appId);
      u.searchParams.set('redirect_uri', redirectUri || facebookRedirectUri(config));
      u.searchParams.set('response_type', 'code');
      u.searchParams.set('state', state);
      u.searchParams.set('prompt', 'login');
      if (config.meta.configId) {
        u.searchParams.set('config_id', config.meta.configId);
      } else {
        u.searchParams.set('scope', config.meta.scopes.join(','));
      }
      return u.toString();
    },

    async exchangeCode(code, redirectUri, mode) {
      if (mock) throw new Error('exchangeCode is not used in mock mode');
      const m = mode || config.authMode || 'facebook';
      const clean = String(code).replace(/#_$/, '').replace(/#_+$/, '');
      if (m === 'instagram') {
        const form = new FormData();
        form.set('client_id', config.meta.appId);
        form.set('client_secret', config.meta.appSecret);
        form.set('grant_type', 'authorization_code');
        form.set('redirect_uri', redirectUri);
        form.set('code', clean);
        const res = await fetch('https://api.instagram.com/oauth/access_token', { method: 'POST', body: form });
        const json = await res.json();
        if (!res.ok) {
          const err = new Error(json?.error_message || json?.error?.message || 'Token exchange failed');
          err.payload = json;
          throw err;
        }
        const item = Array.isArray(json.data) ? json.data[0] : json;
        return {
          accessToken: item.access_token,
          userId: item.user_id ? String(item.user_id) : undefined,
          permissions: item.permissions || '',
          expiresIn: item.expires_in,
        };
      }
      const url = new URL(`https://graph.facebook.com/${config.meta.apiVersion}/oauth/access_token`);
      url.searchParams.set('client_id', config.meta.appId);
      url.searchParams.set('client_secret', config.meta.appSecret);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('code', clean);
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok || json.error) {
        const err = new Error(json?.error?.message || json?.error_message || 'Facebook token exchange failed');
        err.payload = json;
        throw err;
      }
      return {
        accessToken: json.access_token,
        userId: json.user_id ? String(json.user_id) : undefined,
        tokenType: json.token_type,
        expiresIn: json.expires_in,
        permissions: json.permissions || '',
      };
    },

    async exchangeLongLived(shortToken, mode) {
      if (mock) return { accessToken: shortToken, expiresIn: 60 * 24 * 3600 };
      const m = mode || config.authMode || 'facebook';
      if (m === 'instagram') {
        const url = new URL('https://graph.instagram.com/access_token');
        url.searchParams.set('grant_type', 'ig_exchange_token');
        url.searchParams.set('client_secret', config.meta.appSecret);
        url.searchParams.set('access_token', shortToken);
        const res = await fetch(url);
        const json = await res.json();
        if (!res.ok) {
          const err = new Error(json?.error?.message || 'Long-lived token exchange failed');
          err.payload = json;
          throw err;
        }
        return { accessToken: json.access_token, expiresIn: json.expires_in, tokenType: json.token_type };
      }
      // Facebook user token → long-lived (~60 days). Page tokens minted from it do not expire.
      // Business Integration System User tokens may already be long-lived; if this fails we keep the original.
      const url = new URL(`https://graph.facebook.com/${config.meta.apiVersion}/oauth/access_token`);
      url.searchParams.set('grant_type', 'fb_exchange_token');
      url.searchParams.set('client_id', config.meta.appId);
      url.searchParams.set('client_secret', config.meta.appSecret);
      url.searchParams.set('fb_exchange_token', shortToken);
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok || json.error) {
        console.warn('[token] fb_exchange_token failed, keeping original token:', json?.error?.message || res.status);
        return { accessToken: shortToken, expiresIn: null, alreadyLongLived: true };
      }
      return { accessToken: json.access_token, expiresIn: json.expires_in, tokenType: json.token_type };
    },

    async refreshLongLived(token, mode) {
      if (mock) return { accessToken: token, expiresIn: 60 * 24 * 3600 };
      const m = mode || config.authMode || 'facebook';
      if (m !== 'instagram') {
        throw new Error('Facebook Page tokens do not use ig_refresh_token');
      }
      const url = new URL('https://graph.instagram.com/refresh_access_token');
      url.searchParams.set('grant_type', 'ig_refresh_token');
      url.searchParams.set('access_token', token);
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok) {
        const err = new Error(json?.error?.message || 'Token refresh failed');
        err.payload = json;
        throw err;
      }
      return { accessToken: json.access_token, expiresIn: json.expires_in, tokenType: json.token_type };
    },

    async getMe(token, mode) {
      if (mock) {
        return {
          id: 'mock_ig_rona',
          username: 'rona_demo',
          name: 'רונה',
          profile_picture_url: '',
          account_type: 'MEDIA_CREATOR',
          followers_count: 4860,
          media_count: 128,
        };
      }
      const m = mode || config.authMode || 'facebook';
      const host = m === 'instagram' ? 'graph.instagram.com' : 'graph.facebook.com';
      const fields = m === 'instagram'
        ? 'id,username,name,profile_picture_url,account_type'
        : 'id,name,client_business_id';
      return graphFetch(
        `https://${host}/${config.meta.apiVersion}/me?fields=${fields}`,
        { token }
      );
    },

    /**
     * Discover Instagram professional accounts after Facebook Login for Business.
     * Primary path (Page-linked, as used by Rona): GET /me/accounts?fields=...,instagram_business_account
     * Fallback (Unified Login system user token): GET /me/assigned_instagram_accounts
     */
    async listLinkedInstagramAccounts(userToken) {
      const accounts = [];
      let clientBusinessId = null;
      let fbUserId = null;
      try {
        const me = await graphFetch(
          graphUrl(config, '/me', { fields: 'id,name,client_business_id' }),
          { token: userToken }
        );
        fbUserId = me.id || null;
        clientBusinessId = me.client_business_id || null;
      } catch (err) {
        console.warn('[oauth] /me failed:', err.message);
      }

      try {
        const pages = await graphFetch(
          graphUrl(config, '/me/accounts', {
            fields: 'id,name,access_token,instagram_business_account{id,username,name,profile_picture_url,account_type}',
            limit: '100',
          }),
          { token: userToken }
        );
        for (const page of pages.data || []) {
          const ig = page.instagram_business_account;
          if (!ig?.id) continue;
          accounts.push({
            igUserId: String(ig.id),
            username: ig.username,
            name: ig.name,
            profilePictureUrl: ig.profile_picture_url,
            accountType: ig.account_type,
            pageId: String(page.id),
            pageName: page.name,
            pageAccessToken: page.access_token,
            tokenKind: 'page',
          });
        }
      } catch (err) {
        console.warn('[oauth] /me/accounts failed:', err.message);
      }

      if (!accounts.length) {
        try {
          const assigned = await graphFetch(
            graphUrl(config, '/me/assigned_instagram_accounts', {
              fields: 'id,username,name,profile_picture_url',
            }),
            { token: userToken }
          );
          for (const ig of assigned.data || []) {
            accounts.push({
              igUserId: String(ig.id),
              username: ig.username,
              name: ig.name,
              profilePictureUrl: ig.profile_picture_url,
              pageId: null,
              pageName: null,
              pageAccessToken: null,
              tokenKind: 'system_user',
            });
          }
        } catch (err) {
          console.warn('[oauth] /me/assigned_instagram_accounts failed:', err.message);
        }
      }

      return { accounts, clientBusinessId, fbUserId };
    },

    async subscribeWebhooks(account) {
      if (mock) return { skipped: true };
      const token = apiToken(account);
      const out = { page: null, instagram: null, errors: [] };
      if (account.page_id) {
        try {
          // Page subscriptions are required for some Instagram-on-Page notifications.
          // subscribed_fields here must be a Page field (feed). Instagram fields are set in the App Dashboard.
          out.page = await graphFetch(
            graphUrl(config, `/${account.page_id}/subscribed_apps`, { subscribed_fields: 'feed' }, account),
            { method: 'POST', token }
          );
        } catch (err) {
          out.errors.push(`page subscribed_apps: ${err.message}`);
          console.warn('[webhooks] page subscribed_apps:', err.message);
        }
      }
      try {
        out.instagram = await graphFetch(
          graphUrl(
            config,
            `/${account.ig_user_id}/subscribed_apps`,
            { subscribed_fields: 'comments,messages,messaging_postbacks' },
            account
          ),
          { method: 'POST', token }
        );
      } catch (err) {
        out.errors.push(`ig subscribed_apps: ${err.message}`);
        console.warn('[webhooks] ig subscribed_apps:', err.message);
      }
      return out;
    },

    async listMedia(account) {
      return withAccount(
        account,
        (acc) =>
          graphFetch(
            graphUrl(config, `/${acc.ig_user_id}/media`, {
              fields:
                'id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count',
              limit: '50',
            }, acc),
            { token: apiToken(acc) }
          ).then((j) => j.data || []),
        () => MOCK_MEDIA.map((m) => ({ ...m }))
      );
    },


    async findMedia(account, { mediaId, captionPrefix } = {}) {
      const { captionStartsWith } = require('../lib/audit');
      return withAccount(
        account,
        async (acc) => {
          if (mediaId) {
            return graphFetch(
              graphUrl(config, `/${mediaId}`, { fields: MEDIA_FIELDS }, acc),
              { token: apiToken(acc) }
            );
          }
          const items = await graphPaginate(
            graphUrl(config, `/${acc.ig_user_id}/media`, { fields: MEDIA_FIELDS, limit: '50' }, acc),
            { token: apiToken(acc), maxPages: 20, maxItems: 500 }
          );
          if (!captionPrefix) return items[0] || null;
          return items.find((m) => captionStartsWith(m.caption, captionPrefix)) || null;
        },
        () => {
          if (mediaId && mediaId !== MOCK_AUDIT_MEDIA.id) {
            const found = MOCK_MEDIA.find((m) => m.id === mediaId);
            return found ? { ...found } : { ...MOCK_AUDIT_MEDIA, id: mediaId };
          }
          if (!captionPrefix) return { ...MOCK_AUDIT_MEDIA };
          const { captionStartsWith } = require('../lib/audit');
          if (captionStartsWith(MOCK_AUDIT_MEDIA.caption, captionPrefix)) return { ...MOCK_AUDIT_MEDIA };
          const found = MOCK_MEDIA.find((m) => captionStartsWith(m.caption, captionPrefix));
          return found ? { ...found } : null;
        }
      );
    },

    async listMediaComments(account, mediaId) {
      return withAccount(
        account,
        async (acc) => {
          const comments = await graphPaginate(
            graphUrl(
              config,
              `/${mediaId}/comments`,
              {
                fields: 'id,text,username,timestamp,from,replies{id,text,username,timestamp,from}',
                limit: '50',
              },
              acc
            ),
            { token: apiToken(acc), maxPages: 40, maxItems: 2000 }
          );
          const flat = [];
          for (const comment of comments) {
            let replies = (comment.replies && comment.replies.data) || [];
            const repliesNext = comment.replies && comment.replies.paging && comment.replies.paging.next;
            if (repliesNext) {
              const extra = await graphPaginate(repliesNext, { token: apiToken(acc), maxPages: 10, maxItems: 500 });
              // first page already in replies; paging.next starts at the following page
              replies = replies.concat(extra);
            }
            const mappedReplies = replies.map((r) => ({
              id: r.id,
              text: r.text || '',
              username: r.username || r.from?.username || null,
              timestamp: r.timestamp,
              from: r.from || { username: r.username },
              parent_id: comment.id,
              replies: [],
            }));
            flat.push({
              id: comment.id,
              text: comment.text || '',
              username: comment.username || comment.from?.username || null,
              timestamp: comment.timestamp,
              from: comment.from || { username: comment.username },
              parent_id: null,
              replies: mappedReplies,
            });
            for (const r of mappedReplies) flat.push(r);
          }
          return flat;
        },
        () => (mediaId === MOCK_AUDIT_MEDIA.id || !mediaId)
          ? MOCK_AUDIT_COMMENTS.map((c) => ({ ...c, replies: (c.replies || []).map((r) => ({ ...r })) }))
            .flatMap((c) => [c, ...(c.replies || [])])
          : []
      );
    },

    async getComment(account, commentId) {
      return withAccount(
        account,
        async (acc) => graphFetch(
          graphUrl(config, `/${commentId}`, {
            fields: 'id,text,username,timestamp,from,media',
          }, acc),
          { token: apiToken(acc) }
        ),
        () => {
          const id = String(commentId || '');
          const pool = [];
          for (const c of MOCK_AUDIT_COMMENTS) {
            pool.push({ ...c, media: c.media || { id: MOCK_AUDIT_MEDIA.id } });
            for (const r of c.replies || []) {
              pool.push({
                ...r,
                parent_id: r.parent_id || c.id,
                media: r.media || { id: MOCK_AUDIT_MEDIA.id },
                replies: [],
              });
            }
          }
          const found = pool.find((c) => String(c.id) === id);
          if (!found) {
            const err = new Error('comment_not_found');
            err.status = 404;
            throw err;
          }
          return {
            ...found,
            replies: (found.replies || []).map((r) => ({ ...r })),
          };
        }
      );
    },

    async listConversationsWithMessages(account, { participantKeys } = {}) {
      return withAccount(
        account,
        async (acc) => {
          const tried = [];
          const errors = [];
          const candidates = [`/${acc.ig_user_id}/conversations`];
          if (acc.page_id) candidates.push(`/${acc.page_id}/conversations`);
          candidates.push('/me/conversations');

          let conversations = null;
          for (const path of candidates) {
            const endpoint = `${path}?platform=instagram`;
            tried.push(endpoint);
            try {
              conversations = await graphPaginate(
                graphUrl(config, path, {
                  platform: 'instagram',
                  fields: 'id,updated_time,participants{id,username,name}',
                  limit: '50',
                }, acc),
                { token: apiToken(acc), maxPages: 20, maxItems: 500 }
              );
              break;
            } catch (err) {
              errors.push(graphErrorInfo(endpoint, err));
            }
          }

          if (!conversations) {
            return { ok: false, conversations: [], errors, tried };
          }

          const keys = new Set((participantKeys || []).map((k) => String(k || '').toLowerCase()).filter(Boolean));
          const wanted = keys.size
            ? conversations.filter((c) => {
                const parts = c.participants?.data || c.participants || [];
                return parts.some((p) => keys.has(String(p.username || '').toLowerCase()) || keys.has(String(p.id || '')));
              })
            : conversations;

          const detailed = [];
          for (const conv of wanted) {
            const msgEndpoint = `/${conv.id}/messages`;
            try {
              const messages = await graphPaginate(
                graphUrl(config, msgEndpoint, {
                  fields: 'id,created_time,from,to,message,attachments',
                  limit: '50',
                }, acc),
                { token: apiToken(acc), maxPages: 10, maxItems: 300 }
              );
              detailed.push({ ...conv, messages });
            } catch (err) {
              errors.push(graphErrorInfo(msgEndpoint, err));
              detailed.push({ ...conv, messages: [] });
            }
          }
          return { ok: true, conversations: detailed, errors, tried };
        },
        () => ({ ok: true, conversations: MOCK_AUDIT_CONVERSATIONS.map((c) => ({ ...c, messages: [...c.messages] })), errors: [], tried: ['mock'] })
      );
    },

    async replyToComment(account, commentId, message) {
      const payload = { type: 'comment_reply', comment_id: commentId, message };
      if (mock) {
        const result = { id: `mock_reply_${randomId(6)}`, mock: true, ...payload };
        await db.logOutbound({ accountId: account.id, type: 'comment_reply', payload: result, mock: true });
        return result;
      }
      const result = await graphFetch(
        graphUrl(config, `/${commentId}/replies`, null, account),
        { method: 'POST', token: apiToken(account), body: { message } }
      );
      await db.logOutbound({
        accountId: account.id,
        type: 'comment_reply',
        payload: { comment_id: commentId, message, result },
        mock: false,
      });
      return result;
    },

    /**
     * Private Reply: recipient.comment_id, one per comment, within 7 days.
     * Facebook Login / Page-linked: POST /{page-id}/messages with a Page access token.
     * Unified Login fallback / Instagram Login: POST /{ig-user-id}/messages.
     * Follow-up DMs use recipient.id (IGSID) within the 24h window.
     */
    async sendPrivateReply(account, { commentId, igsid, message, quickReplies }) {
      const body = {
        recipient: commentId ? { comment_id: commentId } : { id: igsid },
        message: { text: message },
      };
      if (quickReplies?.length) {
        body.message.quick_replies = quickReplies.map((q) => ({
          content_type: 'text',
          title: String(q.title).slice(0, 20),
          payload: q.payload,
        }));
      }
      if (mock) {
        const result = {
          recipient_id: igsid || `mock_igsid_${randomId(4)}`,
          message_id: `mock_mid_${randomId(8)}`,
          mock: true,
          body,
        };
        await db.logOutbound({
          accountId: account.id,
          type: commentId ? 'private_reply' : 'dm',
          payload: result,
          mock: true,
        });
        return result;
      }
      const result = await graphFetch(
        graphUrl(config, messagesPath(account), null, account),
        { method: 'POST', token: apiToken(account), body }
      );
      await db.logOutbound({
        accountId: account.id,
        type: commentId ? 'private_reply' : 'dm',
        payload: { path: messagesPath(account), body, result },
        mock: false,
      });
      return result;
    },

    async sendGenericTemplate(account, { igsid, title, subtitle, buttonTitle, buttonUrl }) {
      const body = {
        recipient: { id: igsid },
        message: {
          attachment: {
            type: 'template',
            payload: {
              template_type: 'generic',
              elements: [
                {
                  title: title || 'קישור',
                  subtitle: subtitle || undefined,
                  buttons: [
                    {
                      type: 'web_url',
                      url: buttonUrl,
                      title: String(buttonTitle || 'לצפייה').slice(0, 20),
                    },
                  ],
                },
              ],
            },
          },
        },
      };
      if (mock) {
        const result = {
          recipient_id: igsid,
          message_id: `mock_mid_${randomId(8)}`,
          mock: true,
          body,
        };
        await db.logOutbound({ accountId: account.id, type: 'dm_template', payload: result, mock: true });
        return result;
      }
      const result = await graphFetch(
        graphUrl(config, messagesPath(account), null, account),
        { method: 'POST', token: apiToken(account), body }
      );
      await db.logOutbound({
        accountId: account.id,
        type: 'dm_template',
        payload: { path: messagesPath(account), body, result },
        mock: false,
      });
      return result;
    },

    /**
     * User Profile API: GET /{IGSID}?fields=is_user_follow_business
     * On graph.facebook.com this requires a Page access token. Consent is usually
     * granted only after the person has messaged the account (or tapped an icebreaker),
     * so a comment alone may return "User consent is required".
     * We only return false on an explicit negative; otherwise we allow.
     */
    async checkIsFollower(account, igsid, hint) {
      if (hint === true || hint === false) return hint;
      if (config.followCheckMode === 'stub' || mock) return true;
      if (!igsid) return true;
      try {
        const profile = await graphFetch(
          graphUrl(config, `/${igsid}`, { fields: 'is_user_follow_business,username' }, account),
          { token: apiToken(account) }
        );
        if (profile && profile.is_user_follow_business === false) return false;
        if (profile && profile.is_user_follow_business === true) return true;
        return true;
      } catch (err) {
        console.warn('[follow-check] User Profile API failed, allowing by default:', err.message);
        return true;
      }
    },

    async getAccountProfile(account) {
      if (mock || !apiToken(account)) {
        return {
          id: account?.ig_user_id || 'mock_ig_rona',
          username: account?.username || 'rona_demo',
          name: account?.name || 'רונה',
          followers_count: 4860,
          media_count: MOCK_MEDIA.length,
          website: '',
          biography: 'מיילדת · קורס הכנה ללידה',
        };
      }
      return graphFetch(
        graphUrl(config, `/${account.ig_user_id}`, {
          fields: 'id,username,name,followers_count,media_count,biography,website,profile_picture_url',
        }, account),
        { token: apiToken(account) }
      );
    },

    async getAccountInsights(account, { since, until, metrics } = {}) {
      const metricList = metrics || 'reach,views,accounts_engaged,total_interactions,follows_and_unfollows';
      if (mock || !apiToken(account)) {
        const names = String(metricList).split(',').map((s) => s.trim()).filter(Boolean);
        const bases = { reach: 520, views: 890, accounts_engaged: 140, total_interactions: 210, follows_and_unfollows: 8, impressions: 890, profile_views: 60, follower_count: 4800 };
        const amps = { reach: 80, views: 140, accounts_engaged: 25, total_interactions: 30, follows_and_unfollows: 3, impressions: 140, profile_views: 10, follower_count: 20 };
        return { data: names.map((n) => mockInsightMetric(n, since, until, bases[n] || 100, amps[n] || 20)) };
      }
      const params = {
        metric: metricList,
        period: 'day',
        metric_type: 'total_value',
      };
      if (since) params.since = String(since);
      if (until) params.until = String(until);
      try {
        return await graphFetch(
          graphUrl(config, `/${account.ig_user_id}/insights`, params, account),
          { token: apiToken(account) }
        );
      } catch (err) {
        // Older or partial permissions: retry without metric_type, then with legacy impressions.
        const retry = { metric: metricList, period: 'day' };
        if (since) retry.since = String(since);
        if (until) retry.until = String(until);
        try {
          return await graphFetch(
            graphUrl(config, `/${account.ig_user_id}/insights`, retry, account),
            { token: apiToken(account) }
          );
        } catch (err2) {
          const legacy = { ...retry, metric: String(metricList).replace(/\bviews\b/g, 'impressions') };
          try {
            return await graphFetch(
              graphUrl(config, `/${account.ig_user_id}/insights`, legacy, account),
              { token: apiToken(account) }
            );
          } catch (err3) {
            err3.message = err3.message || err2.message || err.message;
            throw err3;
          }
        }
      }
    },

    async getMediaInsights(account, media, { metrics } = {}) {
      const item = typeof media === 'object' && media ? media : { id: media };
      const isReel = item.media_product_type === 'REELS' || item.media_type === 'REELS';
      const metricList = metrics || (isReel
        ? 'views,reach,likes,comments,saved,shares,total_interactions'
        : 'views,reach,likes,comments,saved,shares,total_interactions');
      if (mock || !apiToken(account)) {
        const likes = Number(item.like_count || 80);
        const comments = Number(item.comments_count || 10);
        return {
          data: [
            { name: 'views', values: [{ value: likes * 14 }], total_value: { value: likes * 14 } },
            { name: 'reach', values: [{ value: likes * 9 }], total_value: { value: likes * 9 } },
            { name: 'likes', values: [{ value: likes }], total_value: { value: likes } },
            { name: 'comments', values: [{ value: comments }], total_value: { value: comments } },
            { name: 'total_interactions', values: [{ value: likes + comments }], total_value: { value: likes + comments } },
          ],
        };
      }
      return graphFetch(
        graphUrl(config, `/${item.id}/insights`, { metric: metricList }, account),
        { token: apiToken(account) }
      );
    },

    async businessDiscovery(account, username) {
      const handle = String(username || '').replace(/^@/, '').trim();
      if (!handle) throw new Error('missing_handle');
      if (mock || !apiToken(account)) {
        return {
          business_discovery: {
            username: handle,
            name: handle,
            followers_count: 2500,
            media_count: 180,
            biography: '',
            website: '',
            mock: true,
          },
        };
      }
      return graphFetch(
        graphUrl(config, `/${account.ig_user_id}`, {
          fields: `business_discovery.username(${handle}){followers_count,media_count,biography,website,name,profile_picture_url,username}`,
        }, account),
        { token: apiToken(account) }
      );
    },
  };
}


function mockInsightMetric(name, sinceSec, untilSec, base, amplitude) {
  const since = (Number(sinceSec) || Math.floor(Date.now() / 1000) - 7 * 86400) * 1000;
  const until = (Number(untilSec) || Math.floor(Date.now() / 1000)) * 1000;
  const values = [];
  let i = 0;
  for (let t = since; t < until; t += 86400000) {
    const value = Math.max(0, Math.round(base + amplitude * Math.sin(i / 2) + (i % 3) * 12));
    values.push({ value, end_time: new Date(t + 86400000).toISOString() });
    i += 1;
  }
  const total = values.reduce((s, v) => s + v.value, 0);
  return { name, period: 'day', title: name, description: name, values, total_value: { value: total }, id: `mock/${name}` };
}

function expiresAtFromSeconds(expiresIn) {
  if (expiresIn === null || expiresIn === undefined || expiresIn === '') return null;
  const ms = Number(expiresIn) * 1000;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return new Date(Date.now() + ms).toISOString().replace('T', ' ').slice(0, 19);
}

function tokenAgeHours(account) {
  if (!account.token_refreshed_at && !account.updated_at) return 999;
  const t = Date.parse(String(account.token_refreshed_at || account.updated_at).replace(' ', 'T') + 'Z');
  if (Number.isNaN(t)) return 999;
  return (Date.now() - t) / 36e5;
}

async function refreshDueTokens({ config, db, instagram }) {
  if (config.mockMode) return { refreshed: 0 };
  const accounts = await db.listAccountsWithTokens();
  let refreshed = 0;
  for (const acc of accounts) {
    try {
      // Page tokens minted from a long-lived user token do not expire.
      if (acc.auth_mode !== 'instagram' && (acc.page_access_token || acc.token_kind === 'page')) continue;
      if (acc.auth_mode !== 'instagram') continue;
      if (tokenAgeHours(acc) < 24) continue;
      const result = await instagram.refreshLongLived(acc.access_token, 'instagram');
      await db.updateAccountToken(acc.id, {
        accessToken: result.accessToken,
        tokenExpiresAt: expiresAtFromSeconds(result.expiresIn),
      });
      refreshed += 1;
    } catch (err) {
      console.warn(`[token-refresh] account ${acc.id} (@${acc.username}):`, err.message);
    }
  }
  return { refreshed };
}

module.exports = {
  createInstagramClient,
  MOCK_MEDIA,
  expiresAtFromSeconds,
  refreshDueTokens,
  apiToken,
  messagesPath,
  graphHost,
};
