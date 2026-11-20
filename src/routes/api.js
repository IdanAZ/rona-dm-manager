const express = require('express');
const { requireAuth, requireAccount, publicAccount } = require('./auth');
const { processPayload, mockCommentPayload, mockPostbackPayload, mockMessagePayload } = require('./webhooks');
const { randomId } = require('../lib/signatures');
const { nowSql } = require('../db');
const { collectCommentAudit, attachRecipientFlags, sendManualOpeningDm, sendMissingPublicReply } = require('../services/commentAudit');

function asBool(v, fallback = false) {
  if (v === undefined || v === null || v === '') return fallback;
  return v === true || v === 1 || v === '1' || v === 'true';
}

function variantsToJson(v) {
  if (Array.isArray(v)) return JSON.stringify(v.map((s) => String(s).trim()).filter(Boolean));
  if (typeof v === 'string') {
    const trimmed = v.trim();
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return JSON.stringify(parsed);
      } catch {
        // fall through
      }
    }
    return JSON.stringify(
      trimmed
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
    );
  }
  return '[]';
}

async function serializeAutomation(db, auto) {
  if (!auto) return null;
  const metrics = await db.getAutomationMetrics(auto.id);
  let variants = [];
  try {
    variants = JSON.parse(auto.public_reply_variants || '[]');
  } catch {
    variants = [];
  }
  return {
    ...auto,
    public_reply_enabled: !!auto.public_reply_enabled,
    opening_dm_enabled: !!auto.opening_dm_enabled,
    must_follow: !!auto.must_follow,
    collect_email: !!auto.collect_email,
    followup_enabled: !!auto.followup_enabled,
    next_pending: !!auto.next_pending,
    public_reply_variants: variants,
    metrics,
  };
}

function createApiRouter({ db, config, instagram, engine }) {
  const router = express.Router();

  router.get('/health', (_req, res) => {
    res.json({ ok: true, mockMode: config.mockMode, authMode: config.authMode || 'facebook', time: new Date().toISOString() });
  });

  router.post('/accounts/:id/select', requireAuth, async (req, res, next) => {
    try {
    const id = Number(req.params.id);
    const acc = (await db.listAccountsForUser(req.user.id)).find((a) => a.id === id);
    if (!acc) return res.status(404).json({ error: 'account_not_found' });
    if (req.sessionId) await db.setActiveAccount(req.sessionId, acc.id);
    res.json({ ok: true, account: publicAccount(acc) });
    } catch (err) { next(err); }
  });

  router.delete('/accounts/:id', requireAuth, async (req, res, next) => {
    try {
    const id = Number(req.params.id);
    const acc = (await db.listAccountsForUser(req.user.id)).find((a) => a.id === id);
    if (!acc) return res.status(404).json({ error: 'account_not_found' });
    await db.deleteAccount(acc.id);
    res.json({ ok: true });
    } catch (err) { next(err); }
  });

  router.get('/media', requireAccount, async (req, res) => {
    try {
      const media = await instagram.listMedia(req.account);
      res.json({ media });
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });


  router.get('/audit/keyword-comments', requireAccount, async (req, res) => {
    try {
      const result = await collectCommentAudit(instagram, req.account, {
        keyword: req.query.keyword,
        captionPrefix: req.query.caption_prefix,
        mediaId: req.query.media_id,
        automationId: req.query.automation_id,
      }, db);
      if (result.ok) await attachRecipientFlags(db, req.account, result);
      const status = result.ok ? 200 : (result.error === 'media_not_found' ? 404 : 502);
      res.status(status).json(result);
    } catch (err) {
      res.status(502).json({ ok: false, error: err.message });
    }
  });

  router.post('/audit/keyword-comments/:commentId/send', requireAccount, async (req, res, next) => {
    try {
      const result = await sendManualOpeningDm({
        db,
        instagram,
        engine,
        account: req.account,
        commentId: req.params.commentId,
        mediaId: req.body?.media_id || req.body?.mediaId,
      });
      res.status(result.status || (result.ok ? 200 : 400)).json(result);
    } catch (err) {
      next(err);
    }
  });

  router.post('/audit/keyword-comments/:commentId/public-reply', requireAccount, async (req, res, next) => {
    try {
      const result = await sendMissingPublicReply({
        db,
        instagram,
        engine,
        account: req.account,
        commentId: req.params.commentId,
        mediaId: req.body?.media_id || req.body?.mediaId,
      });
      res.status(result.status || (result.ok ? 200 : 400)).json(result);
    } catch (err) {
      next(err);
    }
  });

  router.patch('/account/settings', requireAccount, async (req, res, next) => {
    try {
      const body = req.body || {};
      if (body.comment_poller_enabled === undefined) {
        return res.status(400).json({ error: 'missing_settings' });
      }
      const account = await db.updateAccountSettings(req.account.id, {
        comment_poller_enabled: body.comment_poller_enabled,
      });
      res.json({ ok: true, account: publicAccount(account) });
    } catch (err) { next(err); }
  });

  router.get('/automations', requireAccount, async (req, res, next) => {
    try {
    const list = await Promise.all((await db.listAutomations(req.account.id)).map((a) => serializeAutomation(db, a)));
    res.json({ automations: list });
    } catch (err) { next(err); }
  });

  function parseBody(accountId, body, existing) {
    const trigger = body.trigger_scope || existing?.trigger_scope || 'specific';
    return {
      account_id: accountId,
      name: body.name || existing?.name || 'אוטומציה חדשה',
      status: body.status || existing?.status || 'paused',
      trigger_scope: trigger,
      media_id: body.media_id ?? existing?.media_id ?? null,
      media_permalink: body.media_permalink ?? existing?.media_permalink ?? null,
      media_thumbnail: body.media_thumbnail ?? existing?.media_thumbnail ?? null,
      media_caption: body.media_caption ?? existing?.media_caption ?? null,
      media_type: body.media_type ?? existing?.media_type ?? null,
      next_pending: trigger === 'next' ? (body.next_pending ?? !body.media_id) : false,
      keyword_mode: body.keyword_mode || existing?.keyword_mode || 'keywords',
      keywords: body.keywords ?? existing?.keywords ?? '',
      match_type: body.match_type || existing?.match_type || 'whole_word',
      public_reply_enabled: asBool(body.public_reply_enabled, existing ? !!existing.public_reply_enabled : true),
      public_reply_variants:
        body.public_reply_variants !== undefined
          ? variantsToJson(body.public_reply_variants)
          : existing?.public_reply_variants || JSON.stringify(['איזה כיף! שלחתי לך הודעה בפרטי ❤️']),
      opening_dm_enabled: asBool(body.opening_dm_enabled, existing ? !!existing.opening_dm_enabled : true),
      opening_dm_text: body.opening_dm_text ?? existing?.opening_dm_text ?? '',
      opening_dm_button_label: body.opening_dm_button_label ?? existing?.opening_dm_button_label ?? 'כן, אשמח ❤️',
      must_follow: asBool(body.must_follow, existing ? !!existing.must_follow : false),
      collect_email: asBool(body.collect_email, existing ? !!existing.collect_email : false),
      second_dm_text: body.second_dm_text ?? existing?.second_dm_text ?? '',
      second_dm_link_url: body.second_dm_link_url ?? existing?.second_dm_link_url ?? '',
      second_dm_link_title: body.second_dm_link_title ?? existing?.second_dm_link_title ?? 'לצפייה',
      followup_enabled: asBool(body.followup_enabled, existing ? !!existing.followup_enabled : false),
      followup_hours: body.followup_hours !== undefined ? Number(body.followup_hours) : existing?.followup_hours ?? 24,
      followup_text: body.followup_text ?? existing?.followup_text ?? '',
    };
  }

  router.post('/automations', requireAccount, async (req, res, next) => {
    try {
    const data = parseBody(req.account.id, req.body || {}, null);
    if (!data.name?.trim()) return res.status(400).json({ error: 'name_required' });
    const auto = await db.createAutomation(data);
    res.status(201).json({ automation: await serializeAutomation(db, auto) });
    } catch (err) { next(err); }
  });

  router.get('/automations/:id', requireAccount, async (req, res, next) => {
    try {
    const auto = await db.getAutomation(Number(req.params.id));
    if (!auto || auto.account_id !== req.account.id) return res.status(404).json({ error: 'not_found' });
    res.json({ automation: await serializeAutomation(db, auto) });
    } catch (err) { next(err); }
  });

  router.put('/automations/:id', requireAccount, async (req, res, next) => {
    try {
    const auto = await db.getAutomation(Number(req.params.id));
    if (!auto || auto.account_id !== req.account.id) return res.status(404).json({ error: 'not_found' });
    const data = parseBody(req.account.id, req.body || {}, auto);
    const updated = await db.updateAutomation(auto.id, data);
    res.json({ automation: await serializeAutomation(db, updated) });
    } catch (err) { next(err); }
  });

  router.delete('/automations/:id', requireAccount, async (req, res, next) => {
    try {
    const auto = await db.getAutomation(Number(req.params.id));
    if (!auto || auto.account_id !== req.account.id) return res.status(404).json({ error: 'not_found' });
    await db.deleteAutomation(auto.id);
    res.json({ ok: true });
    } catch (err) { next(err); }
  });

  router.post('/automations/:id/status', requireAccount, async (req, res, next) => {
    try {
    const auto = await db.getAutomation(Number(req.params.id));
    if (!auto || auto.account_id !== req.account.id) return res.status(404).json({ error: 'not_found' });
    const status = req.body?.status === 'live' ? 'live' : 'paused';
    const updated = await db.updateAutomation(auto.id, { status });
    res.json({ automation: await serializeAutomation(db, updated) });
    } catch (err) { next(err); }
  });

  router.get('/automations/:id/recipients', requireAccount, async (req, res, next) => {
    try {
    const auto = await db.getAutomation(Number(req.params.id));
    if (!auto || auto.account_id !== req.account.id) return res.status(404).json({ error: 'not_found' });
    res.json({ recipients: await db.listRecipients(auto.id), metrics: await db.getAutomationMetrics(auto.id) });
    } catch (err) { next(err); }
  });

  router.get('/logs', requireAccount, async (req, res, next) => {
    try {
    res.json({ logs: await db.listOutbound({ accountId: req.account.id, limit: Number(req.query.limit) || 50 }) });
    } catch (err) { next(err); }
  });

  // Mock / sandbox: fire a fake comment (also works as a manual test hook when MOCK_MODE=true)
  router.post('/mock/comment', requireAccount, async (req, res) => {
    if (!config.mockMode) return res.status(403).json({ error: 'mock_disabled' });
    const body = req.body || {};
    const payload = mockCommentPayload({
      igUserId: req.account.ig_user_id,
      commentId: body.comment_id || `c_${randomId(8)}`,
      text: body.text || '',
      mediaId: body.media_id || 'mock_media_reel_cake',
      fromId: body.from_id || `igsid_${randomId(4)}`,
      fromUsername: body.username || 'follower_demo',
      isFollower: body.is_follower !== false,
    });
    const results = await processPayload(payload, { db, engine });
    const logs = await db.listOutbound({ accountId: req.account.id, limit: 10 });
    res.json({ ok: true, results, logs });
  });

  router.post('/mock/postback', requireAccount, async (req, res) => {
    if (!config.mockMode) return res.status(403).json({ error: 'mock_disabled' });
    const body = req.body || {};
    const payload = mockPostbackPayload({
      igUserId: req.account.ig_user_id,
      senderId: body.sender_id || body.igsid,
      payload: body.payload,
      title: body.title || '',
    });
    const results = await processPayload(payload, { db, engine });
    res.json({ ok: true, results, logs: await db.listOutbound({ accountId: req.account.id, limit: 10 }) });
  });

  router.post('/mock/message', requireAccount, async (req, res) => {
    if (!config.mockMode) return res.status(403).json({ error: 'mock_disabled' });
    const payload = mockMessagePayload({
      igUserId: req.account.ig_user_id,
      senderId: req.body?.sender_id,
      text: req.body?.text || '',
    });
    const results = await processPayload(payload, { db, engine });
    res.json({ ok: true, results });
  });

  router.post('/mock/followups', requireAccount, async (req, res) => {
    if (!config.mockMode) return res.status(403).json({ error: 'mock_disabled' });
    // Optional: backdate a recipient so the follow-up is due immediately
    if (req.body?.recipient_id && req.body?.force_due) {
      const rec = await db.getRecipient(Number(req.body.recipient_id));
      if (rec && rec.account_id === req.account.id) {
        const hours = (await db.getAutomation(rec.automation_id))?.followup_hours || 24;
        const pastSecond = new Date(Date.now() - (hours + 0.1) * 3600 * 1000).toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
        const recentInteraction = new Date(Date.now() - 60 * 1000).toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
        await db.updateRecipient(rec.id, {
          second_sent_at: pastSecond,
          last_user_interaction_at: recentInteraction,
          button_pressed_at: rec.button_pressed_at || recentInteraction,
        });
      }
    }
    const results = await engine.processFollowups();
    res.json({ ok: true, results, logs: await db.listOutbound({ accountId: req.account.id, limit: 10 }) });
  });

  router.post('/mock/publish', requireAccount, async (req, res) => {
    if (!config.mockMode) return res.status(403).json({ error: 'mock_disabled' });
    const media = {
      id: req.body?.media_id || `mock_media_new_${randomId(4)}`,
      caption: req.body?.caption || 'פוסט חדש שהרגע עלה ✨',
      media_type: 'VIDEO',
      media_product_type: 'REELS',
      permalink: 'https://www.instagram.com/reel/mock_new/',
      thumbnail_url: 'https://placehold.co/800x1000/e8d0f0/3a1a4a?text=New',
      timestamp: new Date().toISOString(),
    };
    // Seed cache from the current mock list first, then add the new item as "just published".
    const current = await instagram.listMedia(req.account);
    if (await db.knownMediaCount(req.account.id) === 0) {
      await engine.bindNewMedia(req.account, current);
    }
    const result = await engine.bindNewMedia(req.account, [media, ...current]);
    const autos = await Promise.all((await db.listAutomations(req.account.id)).map((a) => serializeAutomation(db, a)));
    res.json({ ok: true, media, result, automations: autos });
  });

  const { collectInsights } = require('../services/insights');
  const { runWeeklySummaries } = require('../services/weeklySummary');
  const { normalizeLeadStatus, normalizeLeadSource, parseLeadFields } = require('../lib/leads');

  router.get('/insights', requireAccount, async (req, res, next) => {
    try {
      const days = Number(req.query.days) === 7 ? 7 : 30;
      const data = await collectInsights({ db, instagram, account: req.account, days });
      res.json(data);
    } catch (err) { next(err); }
  });

  router.get('/insights/summary', requireAccount, async (req, res, next) => {
    try {
      res.json({ summary: await db.getLatestWeeklySummary(req.account.id) });
    } catch (err) { next(err); }
  });

  router.post('/insights/summary/run', requireAccount, async (req, res, next) => {
    try {
      if (!config.mockMode && config.nodeEnv === 'production') {
        return res.status(403).json({ error: 'manual_run_disabled' });
      }
      const results = await runWeeklySummaries({
        db, instagram, config, force: true, now: new Date(),
      });
      res.json({ ok: true, results, summary: await db.getLatestWeeklySummary(req.account.id) });
    } catch (err) { next(err); }
  });

  router.get('/leads', requireAccount, async (req, res, next) => {
    try {
      const automationId = req.query.automation_id ? Number(req.query.automation_id) : undefined;
      const leads = await db.listLeads(req.account.id, { automationId });
      res.json({ leads });
    } catch (err) { next(err); }
  });

  router.post('/leads', requireAccount, async (req, res, next) => {
    try {
      const body = req.body || {};
      const lead = await db.createLead({
        account_id: req.account.id,
        automation_id: body.automation_id || null,
        source: normalizeLeadSource(body.source, 'manual'),
        status: normalizeLeadStatus(body.status, 'new'),
        username: body.username || null,
        igsid: body.igsid || null,
        comment_id: body.comment_id || null,
        fields: parseLeadFields(body.fields),
      });
      res.json({ lead });
    } catch (err) { next(err); }
  });

  router.patch('/leads/:id', requireAccount, async (req, res, next) => {
    try {
      const lead = await db.getLead(Number(req.params.id));
      if (!lead || Number(lead.account_id) !== Number(req.account.id)) {
        return res.status(404).json({ error: 'lead_not_found' });
      }
      const body = req.body || {};
      const patch = {};
      if (body.status !== undefined) patch.status = normalizeLeadStatus(body.status, lead.status);
      if (body.source !== undefined) patch.source = normalizeLeadSource(body.source, lead.source);
      if (body.username !== undefined) patch.username = body.username;
      if (body.fields !== undefined) patch.fields = { ...parseLeadFields(lead.fields), ...parseLeadFields(body.fields) };
      if (body.automation_id !== undefined) patch.automation_id = body.automation_id;
      const updated = await db.updateLead(lead.id, patch);
      res.json({ lead: updated });
    } catch (err) { next(err); }
  });

  router.get('/partners', requireAccount, async (req, res, next) => {
    try {
      res.json({ partners: await db.listPartners(req.account.id) });
    } catch (err) { next(err); }
  });

  router.post('/partners', requireAccount, async (req, res, next) => {
    try {
      const body = req.body || {};
      if (!String(body.name || '').trim()) return res.status(400).json({ error: 'name_required' });
      const handle = String(body.handle || '').replace(/^@/, '').trim();
      const partner = await db.createPartner({
        account_id: req.account.id,
        name: String(body.name).trim(),
        handle,
        category: body.category || '',
        why_relevant: body.why_relevant || '',
        instagram_url: body.instagram_url || (handle ? `https://www.instagram.com/${handle}/` : ''),
        email: body.email || '',
        phone: body.phone || '',
        website: body.website || '',
        status: body.status || 'idea',
        notes: body.notes || '',
        source_url: body.source_url || '',
      });
      res.json({ partner });
    } catch (err) { next(err); }
  });

  router.patch('/partners/:id', requireAccount, async (req, res, next) => {
    try {
      const partner = await db.getPartner(Number(req.params.id));
      if (!partner || Number(partner.account_id) !== Number(req.account.id)) {
        return res.status(404).json({ error: 'partner_not_found' });
      }
      const body = req.body || {};
      const patch = {};
      for (const key of ['name', 'category', 'why_relevant', 'instagram_url', 'email', 'phone', 'website', 'status', 'notes', 'source_url']) {
        if (body[key] !== undefined) patch[key] = body[key];
      }
      if (body.handle !== undefined) {
        patch.handle = String(body.handle || '').replace(/^@/, '').trim();
        if (!body.instagram_url && patch.handle) patch.instagram_url = `https://www.instagram.com/${patch.handle}/`;
      }
      const updated = await db.updatePartner(partner.id, patch);
      res.json({ partner: updated });
    } catch (err) { next(err); }
  });

  router.delete('/partners/:id', requireAccount, async (req, res, next) => {
    try {
      const partner = await db.getPartner(Number(req.params.id));
      if (!partner || Number(partner.account_id) !== Number(req.account.id)) {
        return res.status(404).json({ error: 'partner_not_found' });
      }
      await db.deletePartner(partner.id);
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  router.post('/partners/:id/enrich', requireAccount, async (req, res, next) => {
    try {
      const partner = await db.getPartner(Number(req.params.id));
      if (!partner || Number(partner.account_id) !== Number(req.account.id)) {
        return res.status(404).json({ error: 'partner_not_found' });
      }
      if (!partner.handle) return res.status(400).json({ error: 'missing_handle' });
      if (!instagram.businessDiscovery) return res.status(501).json({ error: 'discovery_unavailable', partner });
      const disc = await instagram.businessDiscovery(req.account, partner.handle);
      const bd = disc.business_discovery || disc;
      const enrichment = {
        username: bd.username || partner.handle,
        name: bd.name || null,
        followers_count: bd.followers_count ?? null,
        media_count: bd.media_count ?? null,
        biography: bd.biography || '',
        website: bd.website || '',
        profile_picture_url: bd.profile_picture_url || '',
        fetched_at: new Date().toISOString(),
      };
      const patch = { enrichment };
      if (!partner.website && bd.website) patch.website = bd.website;
      const updated = await db.updatePartner(partner.id, patch);
      res.json({ partner: updated });
    } catch (err) {
      err.status = err.status || 502;
      next(err);
    }
  });



  const {
    chatWithAssistant,
    executeProposal,
    cancelProposal,
    assistantStatus,
  } = require('../services/assistant');

  router.get('/assistant/status', requireAccount, (req, res) => {
    res.json(assistantStatus(config));
  });

  router.get('/assistant/messages', requireAccount, async (req, res, next) => {
    try {
      const messages = await db.listAssistantMessages(req.account.id, { limit: 40 });
      res.json({ ...assistantStatus(config), messages });
    } catch (err) { next(err); }
  });

  router.post('/assistant/chat', requireAccount, async (req, res, next) => {
    try {
      const text = req.body?.text || req.body?.message || '';
      const history = Array.isArray(req.body?.history) ? req.body.history : [];
      const result = await chatWithAssistant({
        db, instagram, config, account: req.account, userText: text, history,
      });
      const status = assistantStatus(config);
      res.json({
        ...status,
        ...result,
        banner: status.banner || status.message,
        message: status.banner || status.message,
        saved_message: result.message,
      });
    } catch (err) { next(err); }
  });

  router.post('/assistant/proposals/:id/confirm', requireAccount, async (req, res, next) => {
    try {
      const result = await executeProposal({
        db, config, instagram, account: req.account, proposalId: Number(req.params.id),
      });
      res.json({ ok: true, ...result });
    } catch (err) { next(err); }
  });

  router.post('/assistant/proposals/:id/cancel', requireAccount, async (req, res, next) => {
    try {
      const result = await cancelProposal({ db, account: req.account, proposalId: Number(req.params.id) });
      res.json({ ok: true, ...result });
    } catch (err) { next(err); }
  });

  router.get('/feature-requests', requireAccount, async (req, res, next) => {
    try {
      res.json({ requests: await db.listFeatureRequests(req.account.id) });
    } catch (err) { next(err); }
  });

  router.patch('/feature-requests/:id', requireAccount, async (req, res, next) => {
    try {
      const row = await db.getFeatureRequest(Number(req.params.id));
      if (!row || Number(row.account_id) !== Number(req.account.id)) {
        return res.status(404).json({ error: 'not_found' });
      }
      const status = String(req.body?.status || '');
      if (!['new', 'in-progress', 'done'].includes(status)) {
        return res.status(400).json({ error: 'invalid_status' });
      }
      const request = await db.updateFeatureRequest(row.id, { status });
      res.json({ request });
    } catch (err) { next(err); }
  });


  return router;
}

module.exports = { createApiRouter, serializeAutomation };
