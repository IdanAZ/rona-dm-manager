const { matchesComment } = require('../lib/keywords');
const { randomId } = require('../lib/signatures');
const { nowSql } = require('../db');

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
  async function handleComment(account, event, options = {}) {
    const commentId = String(event.id || event.comment_id || '');
    const text = event.text || '';
    const mediaId = event.media?.id || event.media_id || '';
    const from = event.from || {};
    const igsid = from.id ? String(from.id) : '';
    const username = from.username || '';
    const isSelf = igsid && (igsid === String(account.ig_user_id) || from.self_ig_scoped_id);

    if (!commentId) return { skipped: true, reason: 'missing_comment_id' };
    if (isSelf) {
      await db.markCommentProcessed({ commentId, accountId: account.id, reason: 'self_comment' });
      return { skipped: true, reason: 'self_comment' };
    }
    if (await db.isCommentProcessed(commentId)) {
      return { skipped: true, reason: 'duplicate' };
    }

    const live = await db.listLiveAutomationsForAccount(account.id);
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

    const existingRecipient = await db.findRecipientByCommentOrUser({
      accountId: account.id,
      commentId,
      igsid,
      username,
    });
    if (existingRecipient) {
      await db.markCommentProcessed({
        commentId,
        accountId: account.id,
        automationId: matched.id,
        reason: 'already_recipient',
      });
      return {
        skipped: true,
        reason: 'already_recipient',
        automationId: matched.id,
        recipientId: existingRecipient.id,
      };
    }

    // Mark early to avoid double-processing if two webhooks race.
    await db.markCommentProcessed({
      commentId,
      accountId: account.id,
      automationId: matched.id,
      reason: 'matched',
    });

    if (matched.must_follow) {
      const follows = await instagram.checkIsFollower(account, igsid, options.followerHint);
      if (!follows) {
        if (matched.public_reply_enabled) {
          await instagram.replyToComment(
            account,
            commentId,
            'עקבי לחשבון כדי שאוכל לשלוח לך את הפרטים בפרטי 💌'
          );
        }
        await db.createRecipient({
          automation_id: matched.id,
          account_id: account.id,
          comment_id: commentId,
          igsid,
          username,
          comment_text: text,
          media_id: mediaId,
          status: 'skipped_not_follower',
        });
        return { skipped: true, reason: 'not_follower', automationId: matched.id };
      }
    }

    let publicReply = null;
    if (matched.public_reply_enabled) {
      publicReply = pickVariant(matched.public_reply_variants);
      if (publicReply) {
        await instagram.replyToComment(account, commentId, publicReply);
      }
    }

    let opening = null;
    let recipient = null;
    if (matched.opening_dm_enabled) {
      if (await db.hasPrivateReply(commentId)) {
        recipient = await db.createRecipient({
          automation_id: matched.id,
          account_id: account.id,
          comment_id: commentId,
          igsid,
          username,
          comment_text: text,
          media_id: mediaId,
          status: 'skipped_private_reply_used',
        });
        return {
          skipped: true,
          reason: 'private_reply_already_sent',
          automationId: matched.id,
          publicReply,
        };
      }
      const clickId = randomId(12);
      const buttonLabel = matched.opening_dm_button_label || 'כן, אשמח ❤️';
      // Recipient row first so the button payload can include its id.
      recipient = await db.createRecipient({
        automation_id: matched.id,
        account_id: account.id,
        comment_id: commentId,
        igsid,
        username,
        comment_text: text,
        media_id: mediaId,
        status: 'opening_sent',
        opening_sent_at: nowSql(),
        click_id: clickId,
        last_user_interaction_at: nowSql(),
      });
      const quickReplies = buttonLabel
        ? [{ title: buttonLabel, payload: `QR_YES:${matched.id}:${recipient.id}` }]
        : [];
      opening = await instagram.sendPrivateReply(account, {
        commentId,
        igsid,
        message: matched.opening_dm_text || 'היי! שלחתי לך הודעה 💌',
        quickReplies,
      });
      await db.recordPrivateReply({
        commentId,
        accountId: account.id,
        recipientIgsid: opening.recipient_id || igsid,
        messageId: opening.message_id,
      });
      if (opening.recipient_id && opening.recipient_id !== igsid) {
        await db.updateRecipient(recipient.id, { igsid: opening.recipient_id });
      }
    } else {
      recipient = await db.createRecipient({
        automation_id: matched.id,
        account_id: account.id,
        comment_id: commentId,
        igsid,
        username,
        comment_text: text,
        media_id: mediaId,
        status: 'comment_only',
      });
    }

    return {
      ok: true,
      automationId: matched.id,
      recipientId: recipient?.id,
      publicReply,
      opening,
    };
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
