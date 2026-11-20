const { matchesComment } = require('../lib/keywords');
const { randomId } = require('../lib/signatures');
const { nowSql } = require('../db');
const { isWithinPrivateReplyWindow, publicReplyFromAccount, isSameAccount } = require('../lib/audit');

function pickVariant(raw) {
  let list = raw;
  if (typeof raw === 'string') {
    try {
      list = JSON.parse(raw);
    } catch {
      list = raw.split('\n');
    }
  }
  const variants = (Array.isArray(list) ? list : [])
    .map((s) => String(s || '').trim())
    .filter(Boolean);
  if (!variants.length) return null;
  return variants[Math.floor(Math.random() * variants.length)];
}

function within24h(isoOrSql) {
  if (!isoOrSql) return false;
  const t = Date.parse(String(isoOrSql).includes('T') ? isoOrSql : String(isoOrSql).replace(' ', 'T') + 'Z');
  if (Number.isNaN(t)) return false;
  return Date.now() - t < 24 * 3600 * 1000;
}

function automationMatchesMedia(auto, mediaId) {
  if (auto.trigger_scope === 'any') return true;
  if (auto.trigger_scope === 'specific') return String(auto.media_id) === String(mediaId);
  if (auto.trigger_scope === 'next') {
    if (auto.next_pending) return false; // not bound yet
    return auto.media_id && String(auto.media_id) === String(mediaId);
  }
  return false;
}

function createEngine({ db, instagram, config }) {
  const MAX_SEND_ATTEMPTS = 2;
  const DEFAULT_PUBLIC_REPLY = 'איזה כיף! שלחתי לך הודעה בפרטי ❤️';
  const DEFAULT_OPENING_DM = 'היי! שלחתי לך הודעה 💌';

  function eventComment(event, options) {
    return options.comment || event;
  }

  function commentHasRonaPublicReply(comment, account) {
    if (!comment || !account) return false;
    return publicReplyFromAccount(comment, account).length > 0;
  }

  function recipientHasDm(recipient) {
    if (!recipient) return false;
    return !!(recipient.dm_sent_at || recipient.opening_sent_at);
  }

  async function deliverPublicReply({ account, automation, commentId, recipient, alreadyOnInstagram, source }) {
    if (alreadyOnInstagram) {
      await db.recordObservedPublicReply({
        commentId,
        accountId: account.id,
        recipientId: recipient?.id,
        source: 'instagram',
      });
      if (recipient && !recipient.public_reply_sent_at && String(recipient.comment_id) === String(commentId)) {
        await db.updateRecipient(recipient.id, { public_reply_sent_at: nowSql() });
        recipient.public_reply_sent_at = nowSql();
      }
      return { ok: true, skipped: true, reason: 'already_on_instagram' };
    }
    if (await db.hasPublicReply(commentId)) {
      if (recipient && !recipient.public_reply_sent_at && String(recipient.comment_id) === String(commentId)) {
        await db.updateRecipient(recipient.id, { public_reply_sent_at: nowSql() });
        recipient.public_reply_sent_at = nowSql();
      }
      return { ok: true, skipped: true, reason: 'already_sent' };
    }
    const claim = await db.claimPublicReply({
      commentId,
      accountId: account.id,
      recipientId: recipient?.id,
    });
    if (!claim.claimed) {
      if (claim.row?.status === 'sent') return { ok: true, skipped: true, reason: 'already_sent' };
      if (claim.exhausted) return { ok: false, skipped: true, reason: 'failed_exhausted' };
      return { ok: true, skipped: true, reason: 'in_progress' };
    }
    const text = pickVariant(automation.public_reply_variants) || DEFAULT_PUBLIC_REPLY;
    try {
      const result = await instagram.replyToComment(account, commentId, text);
      await db.markPublicReplySent({ commentId, recipientId: recipient?.id, source: source || 'app' });
      if (recipient && String(recipient.comment_id) === String(commentId)) {
        await db.updateRecipient(recipient.id, { public_reply_sent_at: nowSql() });
        recipient.public_reply_sent_at = nowSql();
      }
      return { ok: true, text, result };
    } catch (err) {
      await db.markPublicReplyFailed({ commentId, error: err.message });
      if (recipient) {
        await db.updateRecipient(recipient.id, { last_error: err.message, status: recipient.dm_sent_at ? recipient.status : 'failed' });
      }
      return { ok: false, error: err.message };
    }
  }

  async function deliverOpeningDm({
    account,
    automation,
    commentId,
    text,
    igsid,
    username,
    mediaId,
    recipient,
    followerHint,
  }) {
    if (!recipient) return { ok: false, error: 'missing_recipient' };
    if (recipientHasDm(recipient) || (await db.hasPrivateReply(commentId))) {
      if (!recipient.dm_sent_at) {
        const when = recipient.opening_sent_at || nowSql();
        await db.updateRecipient(recipient.id, { dm_sent_at: when });
        recipient.dm_sent_at = when;
      }
      return { ok: true, skipped: true, reason: 'already_sent' };
    }
    if (Number(recipient.send_attempts || 0) >= MAX_SEND_ATTEMPTS && recipient.status === 'failed') {
      return { ok: false, skipped: true, reason: 'failed_exhausted' };
    }

    if (automation.must_follow) {
      const follows = await instagram.checkIsFollower(account, igsid, followerHint);
      if (!follows) {
        if (!recipient.public_reply_sent_at && !(await db.hasPublicReply(commentId))) {
          const reminder = 'עקבי לחשבון כדי שאוכל לשלוח לך את הפרטים בפרטי 💌';
          const claim = await db.claimPublicReply({
            commentId,
            accountId: account.id,
            recipientId: recipient.id,
          });
          if (claim.claimed) {
            try {
              await instagram.replyToComment(account, commentId, reminder);
              await db.markPublicReplySent({ commentId, recipientId: recipient.id, source: 'app' });
              await db.updateRecipient(recipient.id, { public_reply_sent_at: nowSql() });
              recipient.public_reply_sent_at = nowSql();
            } catch (err) {
              await db.markPublicReplyFailed({ commentId, error: err.message });
            }
          }
        }
        await db.updateRecipient(recipient.id, { status: 'skipped_not_follower' });
        return { skipped: true, reason: 'not_follower' };
      }
    }

    await db.updateRecipient(recipient.id, {
      send_attempts: Number(recipient.send_attempts || 0) + 1,
    });
    recipient.send_attempts = Number(recipient.send_attempts || 0) + 1;

    if (await db.hasPrivateReply(commentId)) {
      await db.updateRecipient(recipient.id, {
        status: 'skipped_private_reply_used',
        dm_sent_at: nowSql(),
      });
      return { skipped: true, reason: 'private_reply_already_sent' };
    }

    const clickId = recipient.click_id || randomId(12);
    const buttonLabel = automation.opening_dm_button_label || 'כן, אשמח ❤️';
    const message = automation.opening_dm_text || DEFAULT_OPENING_DM;
    if (!recipient.click_id) {
      await db.updateRecipient(recipient.id, { click_id: clickId });
      recipient.click_id = clickId;
    }
    const quickReplies = buttonLabel
      ? [{ title: buttonLabel, payload: `QR_YES:${automation.id}:${recipient.id}` }]
      : [];
    try {
      const opening = await instagram.sendPrivateReply(account, {
        commentId,
        igsid,
        message,
        quickReplies,
      });
      await db.recordPrivateReply({
        commentId,
        accountId: account.id,
        recipientIgsid: opening.recipient_id || igsid,
        messageId: opening.message_id,
      });
      const updates = {
        status: 'opening_sent',
        opening_sent_at: nowSql(),
        dm_sent_at: nowSql(),
        last_user_interaction_at: nowSql(),
        last_error: null,
        click_id: clickId,
      };
      if (opening.recipient_id && opening.recipient_id !== igsid) {
        updates.igsid = opening.recipient_id;
      }
      await db.updateRecipient(recipient.id, updates);
      Object.assign(recipient, updates);
      return { ok: true, opening };
    } catch (err) {
      await db.updateRecipient(recipient.id, { status: 'failed', last_error: err.message });
      recipient.status = 'failed';
      return { ok: false, error: err.message };
    }
  }

  async function processMatchedComment(account, event, matched, options = {}) {
    const commentId = String(event.id || event.comment_id || '');
    const text = event.text || options.comment?.text || '';
    const mediaId = event.media?.id || event.media_id || options.comment?.media?.id || '';
    const from = event.from || options.comment?.from || {};
    const igsid = from.id ? String(from.id) : String(options.comment?.from_id || '');
    const username = from.username || options.comment?.username || '';
    const source = options.source || 'webhook';
    const comment = eventComment(event, options);

    let existing = await db.findRecipientByCommentOrUser({
      accountId: account.id,
      commentId,
      igsid,
      username,
      automationId: matched.id,
    });
    if (!existing) {
      existing = await db.findRecipientByCommentOrUser({
        accountId: account.id,
        commentId,
        igsid,
        username,
      });
    }

    let recipient = existing;
    let claimed = false;
    if (!recipient) {
      const claim = await db.claimRecipient({
        automation_id: matched.id,
        account_id: account.id,
        comment_id: commentId,
        igsid: igsid || null,
        username: username || null,
        comment_text: text,
        media_id: mediaId || null,
        status: 'pending',
        click_id: randomId(12),
      });
      recipient = claim.recipient;
      claimed = claim.claimed;
    }
    if (!recipient) {
      return { skipped: true, reason: 'claim_failed' };
    }

    await db.markCommentProcessed({
      commentId,
      accountId: account.id,
      automationId: matched.id,
      reason: 'matched',
    });

    const alreadyOnInstagram = commentHasRonaPublicReply(comment, account);
    const hasDm = recipientHasDm(recipient) || (await db.hasPrivateReply(commentId));
    const publicOnThisComment = alreadyOnInstagram
      || (await db.hasPublicReply(commentId))
      || !!(recipient.public_reply_sent_at && String(recipient.comment_id) === String(commentId));
    const hasPublic = publicOnThisComment;

    if (hasDm && hasPublic && !claimed) {
      return {
        skipped: true,
        reason: 'already_recipient',
        automationId: matched.id,
        recipientId: recipient.id,
      };
    }

    // must-follow: if they don't follow, only the reminder public reply is sent (no opening DM).
    if (matched.must_follow && !hasDm) {
      const follows = await instagram.checkIsFollower(account, igsid, options.followerHint);
      if (!follows) {
        const dmResult = await deliverOpeningDm({
          account,
          automation: matched,
          commentId,
          text,
          igsid,
          username,
          mediaId,
          recipient,
          followerHint: options.followerHint,
        });
        if (source === 'poller') {
          await db.logOutbound({
            accountId: account.id,
            automationId: matched.id,
            recipientId: recipient.id,
            type: 'poller_send',
            payload: { comment_id: commentId, username, dm: 'not_follower' },
            mock: !!(config && config.mockMode),
          });
        }
        return {
          skipped: true,
          reason: 'not_follower',
          automationId: matched.id,
          recipientId: recipient.id,
          publicReply: dmResult && recipient.public_reply_sent_at ? true : null,
        };
      }
    }

    // Always send both halves when missing. Public reply first, then opening DM.
    const publicResult = await deliverPublicReply({
      account,
      automation: matched,
      commentId,
      recipient,
      alreadyOnInstagram,
      source,
    });

    const dmResult = await deliverOpeningDm({
      account,
      automation: matched,
      commentId,
      text,
      igsid,
      username,
      mediaId,
      recipient,
      followerHint: options.followerHint,
    });

    const didPublic = !!(publicResult && publicResult.ok && !publicResult.skipped);
    const didDm = !!(dmResult && dmResult.ok && !dmResult.skipped);
    if (source === 'poller' && (didPublic || didDm || (dmResult && dmResult.reason === 'not_follower'))) {
      await db.logOutbound({
        accountId: account.id,
        automationId: matched.id,
        recipientId: recipient.id,
        type: 'poller_send',
        payload: {
          comment_id: commentId,
          username,
          public_reply: didPublic ? publicResult.text : (publicResult?.reason || null),
          dm: didDm ? 'sent' : (dmResult?.reason || dmResult?.error || null),
        },
        mock: !!(config && config.mockMode),
      });
    }

    if (dmResult && dmResult.reason === 'not_follower') {
      return { skipped: true, reason: 'not_follower', automationId: matched.id, recipientId: recipient.id };
    }
    if (dmResult && dmResult.reason === 'private_reply_already_sent' && (hasPublic || publicResult?.ok)) {
      return {
        skipped: true,
        reason: 'private_reply_already_sent',
        automationId: matched.id,
        publicReply: publicResult?.text || null,
        recipientId: recipient.id,
      };
    }

    const publicFailed = publicResult && publicResult.ok === false && !publicResult.skipped;
    const dmFailed = dmResult && dmResult.ok === false && !dmResult.skipped;
    if (publicFailed || dmFailed) {
      return {
        ok: false,
        automationId: matched.id,
        recipientId: recipient.id,
        publicReply: publicResult?.text || null,
        opening: dmResult?.opening || null,
        error: dmResult?.error || publicResult?.error,
        reason: dmFailed ? 'dm_failed' : 'public_reply_failed',
        source,
      };
    }

    if (!didPublic && !didDm && !claimed) {
      return {
        skipped: true,
        reason: 'already_recipient',
        automationId: matched.id,
        recipientId: recipient.id,
      };
    }

    return {
      ok: true,
      automationId: matched.id,
      recipientId: recipient.id,
      publicReply: publicResult?.text || null,
      opening: dmResult?.opening || null,
      source,
    };
  }

  async function handleComment(account, event, options = {}) {
    const commentId = String(event.id || event.comment_id || '');
    const text = event.text || options.comment?.text || '';
    const mediaId = event.media?.id || event.media_id || options.comment?.media?.id || '';
    const from = event.from || options.comment?.from || {};
    const igsid = from.id ? String(from.id) : String(options.comment?.from_id || '');
    if (!commentId) return { skipped: true, reason: 'missing_comment_id' };

    const author = { id: igsid, username: from.username || options.comment?.username };
    const isSelf = (igsid && (igsid === String(account.ig_user_id) || from.self_ig_scoped_id))
      || isSameAccount(author, account);
    if (isSelf) {
      await db.markCommentProcessed({ commentId, accountId: account.id, reason: 'self_comment' });
      return { skipped: true, reason: 'self_comment' };
    }

    const live = options.automation
      ? [options.automation]
      : await db.listLiveAutomationsForAccount(account.id);
    const matched = live.find((auto) => {
      if (!automationMatchesMedia(auto, mediaId)) return false;
      return matchesComment({
        text,
        keywordMode: auto.keyword_mode,
        keywords: auto.keywords,
        matchType: auto.match_type,
      });
    });

    if (!matched) {
      await db.markCommentProcessed({ commentId, accountId: account.id, reason: 'no_match' });
      return { skipped: true, reason: 'no_match' };
    }

    return processMatchedComment(account, event, matched, options);
  }

  async function sendSecondDm(account, recipient, automation) {
    const igsid = recipient.igsid;
    if (!igsid) throw new Error('missing IGSID for second DM');
    if (!within24h(recipient.last_user_interaction_at || recipient.button_pressed_at)) {
      await db.updateRecipient(recipient.id, { status: 'window_expired' });
      return { skipped: true, reason: '24h_window_expired' };
    }

    const text = automation.second_dm_text || '';
    const linkUrl = automation.second_dm_link_url;
    const linkTitle = automation.second_dm_link_title || 'לצפייה';
    let result = null;

    if (linkUrl) {
      const tracked = `${config.appUrl}/r/${recipient.click_id}`;
      if (text) {
        result = await instagram.sendPrivateReply(account, { igsid, message: text });
      }
      const tpl = await instagram.sendGenericTemplate(account, {
        igsid,
        title: linkTitle,
        subtitle: text ? undefined : text,
        buttonTitle: linkTitle,
        buttonUrl: tracked,
      });
      result = { text: result, template: tpl };
    } else if (text) {
      result = await instagram.sendPrivateReply(account, { igsid, message: text });
    }

    const updates = {
      second_sent_at: nowSql(),
      status: 'second_sent',
    };
    if (automation.collect_email) {
      updates.awaiting_email = 1;
      // Instagram has no native email quick-reply (unlike Messenger). We ask in text and parse the next message.
      await instagram.sendPrivateReply(account, {
        igsid,
        message: 'אפשר לשלוח לי כאן כתובת אימייל? (רשות) ✉️',
      });
    }
    await db.updateRecipient(recipient.id, updates);
    return { ok: true, result };
  }

  async function handlePostback(account, event) {
    const payload = event.postback?.payload || event.payload || '';
    const igsid = String(event.sender?.id || event.from?.id || '');
    const title = event.postback?.title || '';
    if (!payload.startsWith('QR_YES:')) {
      return { skipped: true, reason: 'unknown_payload' };
    }
    const parts = payload.split(':');
    const automationId = Number(parts[1]);
    const recipientId = Number(parts[2]);
    const recipient = await db.getRecipient(recipientId);
    if (!recipient || recipient.account_id !== account.id || recipient.automation_id !== automationId) {
      return { skipped: true, reason: 'recipient_not_found' };
    }
    if (recipient.button_pressed_at && recipient.second_sent_at) {
      return { skipped: true, reason: 'already_handled' };
    }
    const automation = await db.getAutomation(automationId);
    if (!automation || automation.status !== 'live') {
      return { skipped: true, reason: 'automation_not_live' };
    }

    await db.updateRecipient(recipient.id, {
      button_pressed_at: nowSql(),
      last_user_interaction_at: nowSql(),
      status: 'button_pressed',
      igsid: igsid || recipient.igsid,
    });
    const updated = await db.getRecipient(recipient.id);
    const sent = await sendSecondDm(account, updated, automation);
    return { ok: true, recipientId: recipient.id, title, ...sent };
  }

  async function handleInboundMessage(account, event) {
    const igsid = String(event.sender?.id || '');
    const text = event.message?.text || '';
    const isEcho = event.message?.is_echo || event.is_self;
    if (isEcho || !igsid || !text) return { skipped: true, reason: 'ignored_message' };

    const recipient = await db.findOpenRecipientByIgsid(account.id, igsid);
    if (!recipient) return { skipped: true, reason: 'no_open_recipient' };

    await db.updateRecipient(recipient.id, {
      last_user_interaction_at: nowSql(),
    });

    if (recipient.awaiting_email) {
      const emailMatch = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
      if (emailMatch) {
        await db.updateRecipient(recipient.id, { email: emailMatch[0], awaiting_email: 0 });
        await instagram.sendPrivateReply(account, {
          igsid,
          message: 'תודה! קיבלתי את האימייל 💕',
        });
        return { ok: true, email: emailMatch[0] };
      }
    }

    // If the user types the quick-reply label instead of tapping (common in some clients / mock tests)
    const automation = await db.getAutomation(recipient.automation_id);
    if (
      automation &&
      !recipient.second_sent_at &&
      automation.opening_dm_button_label &&
      text.trim() === automation.opening_dm_button_label.trim()
    ) {
      return await handlePostback(account, {
        sender: { id: igsid },
        postback: { title: text, payload: `QR_YES:${automation.id}:${recipient.id}` },
      });
    }

    return { skipped: true, reason: 'no_action' };
  }

  async function processFollowups() {
    const due = await db.listDueFollowups();
    const results = [];
    for (const row of due) {
      const account = await db.getAccount(row.account_id);
      if (!account) continue;
      try {
        await instagram.sendPrivateReply(account, {
          igsid: row.igsid,
          message: row.followup_text || 'רק מזכירה שעוד לא פתחת את הלינק 💕',
        });
        await db.updateRecipient(row.id, {
          followup_sent_at: nowSql(),
          status: 'followup_sent',
        });
        results.push({ ok: true, recipientId: row.id });
      } catch (err) {
        results.push({ ok: false, recipientId: row.id, error: err.message });
      }
    }
    return results;
  }

  async function bindNewMedia(account, mediaList) {
    const pending = await db.listNextPending(account.id);
    const existingCount = await db.knownMediaCount(account.id);
    // First poll: just seed the cache so historical posts are not treated as "next".
    if (existingCount === 0) {
      for (const m of mediaList) await db.upsertKnownMedia(account.id, m);
      return { seeded: mediaList.length, bound: 0 };
    }
    const fresh = [];
    for (const m of mediaList) {
      if (!(await db.isKnownMedia(account.id, m.id))) fresh.push(m);
    }
    fresh.sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));
    for (const m of mediaList) await db.upsertKnownMedia(account.id, m);
    if (!fresh.length || !pending.length) return { seeded: 0, bound: 0, newMedia: fresh.length };
    const newest = fresh[0];
    for (const auto of pending) {
      await db.bindNextMedia(auto.id, newest);
    }
    return { seeded: 0, bound: pending.length, mediaId: newest.id };
  }

  return {
    handleComment,
    processMatchedComment,
    deliverPublicReply,
    deliverOpeningDm,
    handlePostback,
    handleInboundMessage,
    processFollowups,
    bindNewMedia,
    pickVariant,
    automationMatchesMedia,
    within24h,
  };
}

module.exports = { createEngine, pickVariant, automationMatchesMedia, within24h };
