const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { once } = require('events');
const { createDb } = require('../src/db');
const { createApp } = require('../src/app');
const { createInstagramClient } = require('../src/services/instagram');
const { ruleBasedTurn, proposalFromToolCall, isAllowedAction, proposalsFromToolCalls } = require('../src/lib/assistant');
const { llmConfig } = require('../src/lib/llm');
const { applyAction, executeProposal, chatWithAssistant } = require('../src/services/assistant');

const context = {
  automations: [
    { id: 1, name: 'קורס הכנה ללידה', status: 'live', keywords: 'קורס, לידה' },
    { id: 2, name: 'מתכון — הכנה', status: 'paused', keywords: 'הכנה' },
  ],
  partners: [{ id: 5, name: 'גיל דרור-אסטמקר', handle: 'gil_dror', category: 'midwife', status: 'idea' }],
  leads: [{ id: 9, username: 'yael_tal', status: 'contacted', fields: {} }],
  funnels: [{ name: 'קורס הכנה ללידה', comments_matched: 5, sent: 4, handled_by_owner: 1, converted: 2 }],
  weekly: {
    body: 'הסיכום השבועי שלך\n\nמה עובד: רילס ביום רביעי',
    points: {
      improved: 'החשיפה עלתה ב-12%.',
      dropped: 'הצפיות ירדו ב-5%.',
      recommendation: 'פרסמי ריל ביום רביעי.',
      what_works: { text: 'רילס עובדים הכי טוב ביום רביעי סביב 18:00.', top_posts: [], best_days: [], best_hours: [] },
    },
  },
};

test('only allowlisted actions are accepted', () => {
  assert.equal(isAllowedAction('pause_automation'), true);
  assert.equal(isAllowedAction('create_feature_request'), true);
  assert.equal(isAllowedAction('send_dm'), false);
  assert.equal(isAllowedAction('eval'), false);
  assert.equal(isAllowedAction('delete_account'), false);
});

test('tool calls become proposals and never implicit executes', () => {
  const p = proposalFromToolCall('propose_pause_automation', { automation_id: 1 }, context);
  assert.equal(p.ok, true);
  assert.equal(p.action, 'pause_automation');
  assert.match(p.summary, /קורס הכנה ללידה/);
  const bad = proposalFromToolCall('propose_pause_automation', { automation_id: 99 }, context);
  assert.equal(bad.ok, false);
  const fromCalls = proposalsFromToolCalls([
    { function: { name: 'propose_feature_request', arguments: JSON.stringify({ title: 'ייצוא', body: 'אפשר לייצא לידים לאקסל' }) } },
  ], context);
  assert.equal(fromCalls[0].action, 'create_feature_request');
});

test('rule-based fallback proposes confirmable actions in Hebrew', () => {
  const pause = ruleBasedTurn('השהי את האוטומציה קורס הכנה ללידה', context);
  assert.equal(pause.proposals[0].action, 'pause_automation');
  assert.equal(pause.proposals[0].payload.automation_id, 1);
  assert.match(pause.reply, /אשרי|אשר/);

  const resume = ruleBasedTurn('הפעילי את מתכון — הכנה', context);
  assert.equal(resume.proposals[0].action, 'resume_automation');

  const partner = ruleBasedTurn('הוסיפי שותפה דנה דולה @dana.doula', context);
  assert.equal(partner.proposals[0].action, 'add_partner');
  assert.equal(partner.proposals[0].payload.handle, 'dana.doula');

  const feat = ruleBasedTurn('אני רוצה שבאפליקציה תהיה אפשרות לייצא לידים לאקסל', context);
  assert.equal(feat.proposals[0].action, 'create_feature_request');
  assert.match(feat.reply, /בקשת שיפור/);

  const summary = ruleBasedTurn('מה עובד השבוע?', context);
  assert.equal(summary.proposals.length, 0);
  assert.match(summary.reply, /מה עובד/);
});

test('llmConfig is disabled without a key', () => {
  assert.equal(llmConfig({ llm: {} }).enabled, false);
  assert.equal(llmConfig({ llm: { apiKey: 'xai-test', provider: 'xai' } }).enabled, true);
  assert.equal(llmConfig({ llm: { apiKey: 'xai-test', provider: 'xai' } }).baseUrl, 'https://api.x.ai/v1');
});

async function setupAccount() {
  const db = await createDb(':memory:');
  const userId = await db.createUser();
  const account = await db.upsertAccount({
    userId,
    igUserId: 'ig_assistant',
    username: 'rona_demo',
    name: 'רונה',
    accessToken: 'tok',
  });
  const auto = await db.createAutomation({
    account_id: account.id,
    name: 'קורס הכנה ללידה',
    status: 'live',
    keywords: 'קורס',
    opening_dm_text: 'היי, הנה פרטי הקורס',
    opening_dm_enabled: 1,
    public_reply_enabled: 1,
  });
  return { db, account, auto };
}

test('executeProposal applies a change only after confirm, and cancel leaves data untouched', async () => {
  const { db, account, auto } = await setupAccount();
  const pending = await db.createAssistantProposal({
    account_id: account.id,
    action: 'pause_automation',
    payload: { automation_id: auto.id, name: auto.name },
    summary: 'להשהות',
    status: 'pending',
  });
  await cancelProposalSafe(db, account, pending.id);
  const stillLive = await db.getAutomation(auto.id);
  assert.equal(stillLive.status, 'live');

  const again = await db.createAssistantProposal({
    account_id: account.id,
    action: 'pause_automation',
    payload: { automation_id: auto.id },
    summary: 'להשהות',
  });
  const done = await executeProposal({ db, account, proposalId: again.id, config: { summary: {}, featureRequests: {} } });
  assert.equal(done.proposal.status, 'confirmed');
  assert.equal((await db.getAutomation(auto.id)).status, 'paused');

  await assert.rejects(
    () => executeProposal({ db, account, proposalId: again.id, config: {} }),
    /proposal_not_pending/
  );
  await db.close();
});

async function cancelProposalSafe(db, account, id) {
  const { cancelProposal } = require('../src/services/assistant');
  return cancelProposal({ db, account, proposalId: id });
}

test('applyAction rejects unknown actions and foreign automations', async () => {
  const { db, account } = await setupAccount();
  await assert.rejects(
    () => applyAction({ db, account, action: 'send_dm', payload: {}, config: {} }),
    /action_not_allowed/
  );
  await assert.rejects(
    () => applyAction({ db, account, action: 'pause_automation', payload: { automation_id: 99999 }, config: {} }),
    /automation_not_found/
  );
  await db.close();
});

test('feature request is stored and forwarding is skipped without env', async () => {
  const { db, account } = await setupAccount();
  const result = await applyAction({
    db,
    account,
    action: 'create_feature_request',
    payload: { title: 'ייצוא', body: 'ייצוא לידים לאקסל' },
    config: { featureRequests: {}, summary: {} },
  });
  assert.equal(result.feature_request.status, 'new');
  assert.equal(result.forwarded, false);
  const list = await db.listFeatureRequests(account.id);
  assert.equal(list.length, 1);
  await db.close();
});

async function withApp(fn, extraConfig = {}) {
  const db = await createDb(':memory:');
  const config = {
    mockMode: true,
    nodeEnv: 'test',
    appUrl: 'http://127.0.0.1',
    sessionSecret: 'test-secret',
    sessionTtlDays: 30,
    authMode: 'facebook',
    meta: { apiVersion: 'v23.0', appId: '1', appSecret: 's', scopes: [] },
    summary: {},
    llm: { apiKey: '', provider: '' },
    featureRequests: {},
    ...extraConfig,
  };
  const instagram = createInstagramClient({ config, db });
  const app = createApp({ db, config, instagram, engine: {} });
  const server = http.createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  try {
    const login = await fetch(`http://127.0.0.1:${port}/auth/mock-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'rona_demo' }),
    });
    const cookie = login.headers.get('set-cookie');
    await fn({ db, config, instagram, port, cookie });
  } finally {
    server.close();
    await db.close();
  }
}

test('assistant API uses fallback without a key, confirm applies, unconfirmed changes nothing', async () => {
  await withApp(async ({ port, cookie, db }) => {
    const status = await (await fetch(`http://127.0.0.1:${port}/api/assistant/status`, { headers: { cookie } })).json();
    assert.equal(status.llm_enabled, false);
    assert.equal(status.fallback, true);
    assert.match(status.message, /תופעל בקרוב/);

    const chat = await fetch(`http://127.0.0.1:${port}/api/assistant/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ text: 'השהי את האוטומציה קורס הכנה ללידה' }),
    });
    assert.equal(chat.status, 200);
    const body = await chat.json();
    assert.ok(body.proposals.length >= 1);
    const proposal = body.proposals[0];
    assert.equal(proposal.action, 'pause_automation');
    assert.equal(proposal.status, 'pending');

    const autosBefore = await (await fetch(`http://127.0.0.1:${port}/api/automations`, { headers: { cookie } })).json();
    const course = (autosBefore.automations || autosBefore).find
      ? (autosBefore.automations || autosBefore).find((a) => a.name.includes('קורס'))
      : null;
    // handle either shape
    let list = autosBefore.automations || autosBefore;
    if (!Array.isArray(list)) list = [];
    const before = list.find((a) => String(a.name).includes('קורס'));
    if (before) assert.equal(before.status, 'live');

    const confirm = await fetch(`http://127.0.0.1:${port}/api/assistant/proposals/${proposal.id}/confirm`, {
      method: 'POST',
      headers: { cookie },
    });
    assert.equal(confirm.status, 200);
    const confirmed = await confirm.json();
    assert.equal(confirmed.proposal.status, 'confirmed');
    assert.equal(confirmed.result.automation.status, 'paused');
  });
});

test('assistant chat can save a feature request only after confirm', async () => {
  await withApp(async ({ port, cookie }) => {
    const chat = await fetch(`http://127.0.0.1:${port}/api/assistant/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ text: 'אני רוצה שבאפליקציה תהיה אפשרות לייצא לידים לאקסל' }),
    });
    const body = await chat.json();
    const proposal = body.proposals[0];
    assert.equal(proposal.action, 'create_feature_request');

    const empty = await (await fetch(`http://127.0.0.1:${port}/api/feature-requests`, { headers: { cookie } })).json();
    assert.equal(empty.requests.length, 0);

    await fetch(`http://127.0.0.1:${port}/api/assistant/proposals/${proposal.id}/confirm`, {
      method: 'POST',
      headers: { cookie },
    });
    const after = await (await fetch(`http://127.0.0.1:${port}/api/feature-requests`, { headers: { cookie } })).json();
    assert.equal(after.requests.length, 1);
    assert.equal(after.requests[0].status, 'new');
    assert.match(after.requests[0].body, /ייצא לידים/);

    const patched = await fetch(`http://127.0.0.1:${port}/api/feature-requests/${after.requests[0].id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ status: 'in-progress' }),
    });
    assert.equal(patched.status, 200);
    assert.equal((await patched.json()).request.status, 'in-progress');
  });
});

test('chatWithAssistant uses LLM tool calls when a key and fetch stub are provided, still only proposing', async () => {
  const { db, account, auto } = await setupAccount();
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify({
        choices: [{
          message: {
            role: 'assistant',
            content: 'אפשר להשהות, רק אחרי אישור.',
            tool_calls: [{
              function: {
                name: 'propose_pause_automation',
                arguments: JSON.stringify({ automation_id: auto.id }),
              },
            }],
          },
        }],
      });
    },
  });
  const result = await chatWithAssistant({
    db,
    instagram: { listMedia: async () => [] },
    config: { llm: { apiKey: 'test', provider: 'openai', baseUrl: 'https://example.invalid/v1', model: 'test' }, summary: {}, featureRequests: {} },
    account,
    userText: 'תשהי את הקורס',
    fetchImpl,
  });
  assert.equal(result.source, 'llm');
  assert.equal(result.proposals[0].status, 'pending');
  assert.equal((await db.getAutomation(auto.id)).status, 'live');
  await db.close();
});
