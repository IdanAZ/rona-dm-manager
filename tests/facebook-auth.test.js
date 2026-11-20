const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createInstagramClient, messagesPath, graphHost } = require('../src/services/instagram');
const { createDb } = require('../src/db');

test('facebook authorization URL uses config_id and does not send scope', async () => {
  const config = {
    mockMode: false,
    authMode: 'facebook',
    appUrl: 'https://example.trycloudflare.com',
    meta: {
      appId: '1171722368541387',
      configId: 'cfg_123',
      apiVersion: 'v23.0',
      scopes: ['instagram_basic', 'pages_show_list'],
    },
  };
  const ig = createInstagramClient({ config, db: await createDb(':memory:') });
  const url = new URL(ig.authorizationUrl({ state: 'abc', mode: 'facebook' }));
  assert.equal(url.origin + url.pathname, 'https://www.facebook.com/v23.0/dialog/oauth');
  assert.equal(url.searchParams.get('client_id'), '1171722368541387');
  assert.equal(url.searchParams.get('config_id'), 'cfg_123');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('state'), 'abc');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://example.trycloudflare.com/auth/facebook/callback');
  assert.equal(url.searchParams.get('scope'), null);
});

test('instagram authorization URL is still available when AUTH_MODE=instagram', async () => {
  const config = {
    mockMode: false,
    authMode: 'instagram',
    appUrl: 'https://example.com',
    meta: {
      appId: '111',
      apiVersion: 'v23.0',
      scopes: ['instagram_business_basic'],
    },
  };
  const ig = createInstagramClient({ config, db: await createDb(':memory:') });
  const url = new URL(ig.authorizationUrl({ state: 's', mode: 'instagram' }));
  assert.equal(url.hostname, 'www.instagram.com');
  assert.ok(url.searchParams.get('scope').includes('instagram_business_basic'));
});

test('facebook mode sends messages to the Page messages endpoint', () => {
  const account = { page_id: '105852474332924', ig_user_id: '1784140000' };
  assert.equal(messagesPath(account), '/105852474332924/messages');
  assert.equal(graphHost({ authMode: 'facebook' }, account), 'graph.facebook.com');
  assert.equal(graphHost({ authMode: 'instagram' }, { auth_mode: 'instagram' }), 'graph.instagram.com');
});
