const { llmConfig, chatCompletions } = require('../lib/llm');
const { emailConfigured, sendEmail } = require('../lib/email');
const {
  toolDefinitions,
  proposalsFromToolCalls,
  proposalFromToolCall,
  buildContextSummary,
  systemPrompt,
  ruleBasedTurn,
  isAllowedAction,
  sanitizeAutomationFields,
  sanitizePartnerFields,
  ACTION_LABELS,
} = require('../lib/assistant');
const { normalizeLeadStatus, parseLeadFields } = require('../lib/leads');
const { collectInsights } = require('./insights');

async function loadAssistantContext({ db, instagram, account }) {
  const automations = (await db.listAutomations(account.id)) || [];
  const partners = (await db.listPartners(account.id)) || [];
  const leads = (await db.listLeads(account.id)) || [];
  let insights = null;
  try {
    insights = await collectInsights({ db, instagram, account, days: 30 });
  } catch (err) {
    console.warn('[assistant] insights context skipped:', err.message);
  }
  return {
    automations,
    partners,
    leads,
    funnels: insights?.funnels || [],
    weekly: insights?.weekly_summary || (await db.getLatestWeeklySummary(account.id)),
    insights,
  };
}

function publicProposal(row) {
  if (!row) return null;
  let payload = row.payload;
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload); } catch { payload = {}; }
  }
  return {
    id: row.id,
    action: row.action,
    label: ACTION_LABELS[row.action] || row.action,
    summary: row.summary,
    payload,
    status: row.status,
    created_at: row.created_at,
    resolved_at: row.resolved_at || null,
    error: row.error || null,
  };
}

async function persistProposals(db, accountId, drafts) {
  const saved = [];
  for (const draft of drafts || []) {
    if (!draft?.ok || !isAllowedAction(draft.action)) continue;
    const row = await db.createAssistantProposal({
      account_id: accountId,
      action: draft.action,
      payload: draft.payload,
      summary: draft.summary,
      status: 'pending',
    });
    saved.push(publicProposal(row));
  }
  return saved;
}

async function chatWithAssistant({ db, instagram, config, account, userText, history = [], fetchImpl } = {}) {
  const text = String(userText || '').trim();
  if (!text) {
    const err = new Error('empty_message');
    err.status = 400;
    throw err;
  }
  const llm = llmConfig(config);
  const context = await loadAssistantContext({ db, instagram, account });
  await db.addAssistantMessage({
    account_id: account.id,
    role: 'user',
    content: text,
  });

  let reply = '';
  let source = 'rules';
  let drafts = [];

  if (llm.enabled) {
    try {
      const messages = [
        { role: 'system', content: systemPrompt() },
        { role: 'system', content: 'הקשר עדכני מהאפליקציה:\n' + buildContextSummary(context) },
        ...((history || []).slice(-12).map((m) => ({ role: m.role, content: String(m.content || '') }))),
        { role: 'user', content: text },
      ];
      const result = await chatCompletions(llm, {
        messages,
        tools: toolDefinitions(),
      }, fetchImpl);
      const msg = result.message || {};
      reply = String(msg.content || '').trim();
      drafts = proposalsFromToolCalls(msg.tool_calls || [], context).filter((p) => p.ok);
      source = 'llm';
      if (!reply && drafts.length) {
        reply = 'הכנתי הצעה בשבילך. שום דבר לא משתנה עד שתלחצי «אשרי».';
      }
      if (!reply) reply = 'אני כאן, נסי לנסח שוב ואציע פעולה רק אם צריך.';
    } catch (err) {
      console.warn('[assistant] LLM failed, falling back to rules:', err.message);
      const fallback = ruleBasedTurn(text, context);
      reply = `לא הצלחתי להפעיל את העוזרת החכמה ברגע זה, אז עניתי לפי הכללים.\n\n${fallback.reply}`;
      drafts = fallback.proposals;
      source = 'rules_fallback';
    }
  } else {
    const fallback = ruleBasedTurn(text, context);
    reply = fallback.reply;
    drafts = fallback.proposals;
    source = 'rules';
  }

  const proposals = await persistProposals(db, account.id, drafts);
  const saved = await db.addAssistantMessage({
    account_id: account.id,
    role: 'assistant',
    content: reply,
    proposals,
  });

  return {
    reply,
    source,
    llm_enabled: llm.enabled,
    proposals,
    message: saved,
  };
}

async function executeProposal({ db, config, account, proposalId, instagram }) {
  const row = await db.getAssistantProposal(proposalId);
  if (!row || Number(row.account_id) !== Number(account.id)) {
    const err = new Error('proposal_not_found');
    err.status = 404;
    throw err;
  }
  if (row.status !== 'pending') {
    const err = new Error('proposal_not_pending');
    err.status = 409;
    throw err;
  }
  if (!isAllowedAction(row.action)) {
    await db.updateAssistantProposal(row.id, { status: 'failed', error: 'action_not_allowed' });
    const err = new Error('action_not_allowed');
    err.status = 400;
    throw err;
  }
  let payload = row.payload;
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload); } catch { payload = {}; }
  }

  try {
    const result = await applyAction({ db, config, account, action: row.action, payload, instagram });
    const updated = await db.updateAssistantProposal(row.id, { status: 'confirmed', error: null });
    return { proposal: publicProposal(updated), result };
  } catch (err) {
    await db.updateAssistantProposal(row.id, { status: 'failed', error: err.message });
    throw err;
  }
}

async function cancelProposal({ db, account, proposalId }) {
  const row = await db.getAssistantProposal(proposalId);
  if (!row || Number(row.account_id) !== Number(account.id)) {
    const err = new Error('proposal_not_found');
    err.status = 404;
    throw err;
  }
  if (row.status !== 'pending') {
    const err = new Error('proposal_not_pending');
    err.status = 409;
    throw err;
  }
  const updated = await db.updateAssistantProposal(row.id, { status: 'cancelled' });
  return { proposal: publicProposal(updated) };
}

async function applyAction({ db, config, account, action, payload }) {
  switch (action) {
    case 'pause_automation': {
      const auto = await ownedAutomation(db, account, payload.automation_id);
      return { automation: await db.updateAutomation(auto.id, { status: 'paused' }) };
    }
    case 'resume_automation': {
      const auto = await ownedAutomation(db, account, payload.automation_id);
      return { automation: await db.updateAutomation(auto.id, { status: 'live' }) };
    }
    case 'update_automation': {
      const auto = await ownedAutomation(db, account, payload.automation_id);
      const fields = sanitizeAutomationFields(payload.fields || {});
      if (!Object.keys(fields).length) throw Object.assign(new Error('empty_fields'), { status: 400 });
      if (fields.public_reply_variants && Array.isArray(fields.public_reply_variants)) {
        fields.public_reply_variants = JSON.stringify(fields.public_reply_variants);
      }
      for (const boolKey of ['opening_dm_enabled', 'public_reply_enabled', 'followup_enabled', 'must_follow', 'collect_email']) {
        if (fields[boolKey] !== undefined) fields[boolKey] = fields[boolKey] ? 1 : 0;
      }
      return { automation: await db.updateAutomation(auto.id, fields) };
    }
    case 'create_automation': {
      const created = await db.createAutomation({
        account_id: account.id,
        name: String(payload.name || '').trim(),
        status: 'paused',
        trigger_scope: payload.trigger_scope || 'any',
        keyword_mode: payload.keywords ? 'keywords' : 'any',
        keywords: payload.keywords || '',
        match_type: 'whole_word',
        public_reply_enabled: 1,
        public_reply_variants: JSON.stringify(payload.public_reply_variants || ['איזה כיף! שלחתי לך הודעה בפרטי ❤️']),
        opening_dm_enabled: 1,
        opening_dm_text: payload.opening_dm_text || 'היי! שמחה שאהבת 😊',
        opening_dm_button_label: payload.opening_dm_button_label || 'כן, אשמח ❤️',
        must_follow: 0,
        collect_email: 0,
        second_dm_text: payload.second_dm_text || '',
        followup_enabled: 0,
      });
      return { automation: created };
    }
    case 'add_partner': {
      const fields = sanitizePartnerFields(payload);
      if (!fields.name) throw Object.assign(new Error('name_required'), { status: 400 });
      const handle = fields.handle || '';
      const partner = await db.createPartner({
        account_id: account.id,
        ...fields,
        instagram_url: handle ? `https://www.instagram.com/${handle}/` : '',
        status: fields.status || 'idea',
      });
      return { partner };
    }
    case 'update_partner': {
      const partner = await db.getPartner(payload.partner_id);
      if (!partner || Number(partner.account_id) !== Number(account.id)) {
        throw Object.assign(new Error('partner_not_found'), { status: 404 });
      }
      const fields = sanitizePartnerFields(payload.fields || {});
      if (fields.handle && !fields.instagram_url) {
        fields.instagram_url = `https://www.instagram.com/${fields.handle}/`;
      }
      return { partner: await db.updatePartner(partner.id, fields) };
    }
    case 'update_lead': {
      const lead = await db.getLead(payload.lead_id);
      if (!lead || Number(lead.account_id) !== Number(account.id)) {
        throw Object.assign(new Error('lead_not_found'), { status: 404 });
      }
      const patch = {};
      if (payload.status) patch.status = normalizeLeadStatus(payload.status, lead.status);
      if (payload.username) patch.username = payload.username;
      if (payload.fields) patch.fields = { ...parseLeadFields(lead.fields), ...parseLeadFields(payload.fields) };
      return { lead: await db.updateLead(lead.id, patch) };
    }
    case 'create_feature_request': {
      const title = String(payload.title || payload.body || '').trim().slice(0, 80);
      const body = String(payload.body || '').trim();
      if (!body) throw Object.assign(new Error('body_required'), { status: 400 });
      const request = await db.createFeatureRequest({
        account_id: account.id,
        title: title || 'בקשת שיפור',
        body,
        status: 'new',
      });
      const forward = await forwardFeatureRequest({ config, account, request });
      if (forward?.ok && db.markFeatureRequestForwarded) {
        await db.markFeatureRequestForwarded(request.id, new Date());
      }
      return { feature_request: request, forwarded: !!(forward && forward.ok), forward };
    }
    default:
      throw Object.assign(new Error('action_not_allowed'), { status: 400 });
  }
}

async function ownedAutomation(db, account, id) {
  const auto = await db.getAutomation(id);
  if (!auto || Number(auto.account_id) !== Number(account.id)) {
    throw Object.assign(new Error('automation_not_found'), { status: 404 });
  }
  return auto;
}

async function forwardFeatureRequest({ config, account, request, transport } = {}) {
  const hook = config?.featureRequests?.webhookUrl;
  const emailTo = config?.featureRequests?.emailTo;
  const results = { ok: false, webhook: null, email: null };
  if (!hook && !emailTo) return { ok: false, skipped: true, reason: 'forward_not_configured' };

  if (hook) {
    try {
      const res = await fetch(hook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'feature_request',
          account: { id: account.id, username: account.username },
          request,
        }),
      });
      results.webhook = { status: res.status };
      if (!res.ok) throw new Error(`webhook ${res.status}`);
    } catch (err) {
      results.webhook = { error: err.message };
      console.warn('[feature-request] webhook failed:', err.message);
    }
  }

  if (emailTo) {
    const mailConfig = {
      summary: {
        emailTo,
        emailFrom: config.featureRequests?.emailFrom || config.summary?.emailFrom,
        resendApiKey: config.summary?.resendApiKey,
        smtpHost: config.summary?.smtpHost,
        smtpPort: config.summary?.smtpPort,
        smtpUser: config.summary?.smtpUser,
        smtpPass: config.summary?.smtpPass,
        smtpSecure: config.summary?.smtpSecure,
      },
    };
    if (emailConfigured(mailConfig) || transport) {
      try {
        results.email = await sendEmail(mailConfig, {
          subject: `בקשת שיפור · ${request.title}`,
          text: `חשבון: @${account.username || account.id}\n\n${request.title}\n\n${request.body}`,
        }, transport);
      } catch (err) {
        results.email = { error: err.message };
        console.warn('[feature-request] email failed:', err.message);
      }
    }
  }

  results.ok = !!(results.webhook && !results.webhook.error && results.webhook.status < 300)
    || !!(results.email && !results.email.error && !results.email.skipped);
  return results;
}

function assistantStatus(config) {
  const llm = llmConfig(config);
  return {
    llm_enabled: llm.enabled,
    provider: llm.enabled ? llm.provider : null,
    model: llm.enabled ? llm.model : null,
    fallback: !llm.enabled,
    banner: llm.enabled
      ? 'אפשר לדבר איתי חופשי. פעולות יופיעו לאישור לפני שינוי.'
      : 'העוזרת החכמה תופעל במלואה בקרוב. בינתיים פעולות פשוטות כבר עובדות.',
    // Keep a string `message` for the banner only — never a chat row object.
    message: llm.enabled
      ? 'אפשר לדבר איתי חופשי. פעולות יופיעו לאישור לפני שינוי.'
      : 'העוזרת החכמה תופעל במלואה בקרוב. בינתיים פעולות פשוטות כבר עובדות.',
  };
}

module.exports = {
  loadAssistantContext,
  chatWithAssistant,
  executeProposal,
  cancelProposal,
  applyAction,
  forwardFeatureRequest,
  assistantStatus,
  publicProposal,
};
