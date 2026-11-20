const {
  DEFAULT_KEYWORD,
  DEFAULT_CAPTION_PREFIX,
  buildAudit,
  isWithinPrivateReplyWindow,
} = require('../lib/audit');
const { matchesComment } = require('../lib/keywords');
const { automationMatchesMedia } = require('./engine');
const { randomId } = require('../lib/signatures');
const { nowSql } = require('../db');

function authorKeys(comments, account) {
  const keys = new Set();
  const own = new Set(
    [account?.username, account?.ig_user_id, account?.page_id]
      .map((v) => String(v || '').toLowerCase())
      .filter(Boolean)
  );
  for (const comment of comments || []) {
    const username = String(comment.username || comment.from?.username || '').toLowerCase();
    const id = String(comment.from?.id || comment.from_id || '');
    if (username && !own.has(username)) keys.add(username);
    if (id && !own.has(id.toLowerCase())) keys.add(id);
  }
  return [...keys];
}

async function collectKeywordCommentAudit(instagram, account, query = {}) {
  const keyword = query.keyword || DEFAULT_KEYWORD;
  const captionPrefix = query.captionPrefix || query.caption_prefix || DEFAULT_CAPTION_PREFIX;
  const mediaId = query.mediaId || query.media_id || '';
  const now = query.now || new Date();
  const errors = [];

  let media;
  try {
    media = await instagram.findMedia(account, { mediaId: mediaId || undefined, captionPrefix });
  } catch (err) {
    return {
      ok: false,
      error: 'media_lookup_failed',
      message: err.message,
      keyword,
      caption_prefix: captionPrefix,
      errors: [{ endpoint: mediaId ? `/${mediaId}` : `/${account.ig_user_id}/media`, message: err.message }],
    };
  }

  if (!media) {
    return {
      ok: false,
      error: 'media_not_found',
      message: 'לא נמצא פוסט שמתחיל בתיאור שהוגדר.',
      keyword,
      caption_prefix: captionPrefix,
      errors: [],
    };
  }

  let comments = [];
  try {
    comments = await instagram.listMediaComments(account, media.id);
  } catch (err) {
    return {
      ok: false,
      error: 'comments_lookup_failed',
      message: err.message,
      keyword,
      media: { id: media.id, caption: media.caption, permalink: media.permalink },
      errors: [{ endpoint: `/${media.id}/comments`, message: err.message, status: err.status || null }],
    };
  }

  let conversations = [];
  let conversationsAvailable = false;
  let tried = [];
  try {
    const convResult = await instagram.listConversationsWithMessages(account, {
      participantKeys: authorKeys(comments, account),
    });
    conversations = convResult.conversations || [];
    conversationsAvailable = !!convResult.ok;
    tried = convResult.tried || [];
    if (Array.isArray(convResult.errors)) errors.push(...convResult.errors);
  } catch (err) {
    errors.push({ endpoint: 'conversations', message: err.message, status: err.status || null });
    conversationsAvailable = false;
  }

  const audit = buildAudit({
    media,
    comments,
    conversations,
    account,
    keyword,
    now,
    conversationsAvailable,
  });

  return {
    ok: true,
    ...audit,
    caption_prefix: captionPrefix,
    errors,
    tried_endpoints: tried,
  };
}


async function loadComment(instagram, account, commentId, mediaId) {
  const id = String(commentId || '');
  try {
    const comment = await instagram.getComment(account, id);
    if (comment && mediaId && !comment.media) comment.media = { id: mediaId };
    if (comment && mediaId && comment.media && !comment.media.id) comment.media.id = mediaId;
    return comment;
  } catch (err) {
    if (!mediaId || typeof instagram.listMediaComments !== 'function') throw err;
    const comments = await instagram.listMediaComments(account, mediaId);
    const found = (comments || []).find((c) => String(c.id) === id);
    if (!found) throw err;
    return { ...found, media: found.media || { id: mediaId } };
  }
}

async function attachRecipientFlags(db, account, result) {
  if (!result || !Array.isArray(result.items) || !db) return result;
  for (const item of result.items) {
    const existing = await db.findRecipientByCommentOrUser({
      accountId: account.id,
      commentId: item.comment_id,
      igsid: item.igsid,
      username: item.username,
    });
    item.already_recorded = !!existing;
    item.recipient_id = existing?.id || null;
    item.can_send = !!item.within_private_reply_window && !existing && item.dm_status !== 'already_got_dm';
  }
  return result;
}

async function sendManualOpeningDm({ db, instagram, account, commentId, mediaId, now } = {}) {
  const id = String(commentId || '').trim();
  if (!id) {
    return { ok: false, status: 400, error: 'missing_comment_id', message: 'חסר מזהה תגובה.' };
  }

  let comment;
  try {
    comment = await loadComment(instagram, account, id, mediaId);
  } catch (err) {
    return {
      ok: false,
      status: err.status === 404 ? 404 : 502,
      error: 'comment_not_found',
      message: err.message || 'התגובה לא נמצאה.',
    };
  }
  if (!comment) {
    return { ok: false, status: 404, error: 'comment_not_found', message: 'התגובה לא נמצאה.' };
  }

  const when = now || new Date();
  if (!isWithinPrivateReplyWindow(comment.timestamp, when)) {
    return {
      ok: false,
      status: 400,
      error: 'comment_too_old',
      message: 'לא ניתן לשלוח תשובה פרטית לתגובה שגילה מעל 7 ימים.',
    };
  }

  const text = comment.text || '';
  const igsid = String(comment.from?.id || comment.from_id || '');
  const username = comment.username || comment.from?.username || '';
  const commentMediaId = String(comment.media?.id || mediaId || '');

  const existing = await db.findRecipientByCommentOrUser({
    accountId: account.id,
    commentId: id,
    igsid,
    username,
  });
  if (existing) {
    return {
      ok: false,
      status: 409,
      error: 'already_sent',
      message: 'ההודעה כבר נשלחה לנמענת הזו.',
      recipient_id: existing.id,
    };
  }
  if (await db.hasPrivateReply(id)) {
    return {
      ok: false,
      status: 409,
      error: 'already_sent',
      message: 'כבר נשלחה תשובה פרטית לתגובה הזו.',
    };
  }

  const live = await db.listLiveAutomationsForAccount(account.id);
  const matched = live.find((auto) => {
    if (!automationMatchesMedia(auto, commentMediaId)) return false;
    return matchesComment({
      text,
      keywordMode: auto.keyword_mode,
      keywords: auto.keywords,
      matchType: auto.match_type,
    });
  });
  if (!matched) {
    return {
      ok: false,
      status: 404,
      error: 'no_matching_automation',
      message: 'לא נמצאה אוטומציה מתאימה לתגובה הזו.',
    };
  }

  const openingText = String(matched.opening_dm_text || '').trim();
  if (!openingText) {
    return {
      ok: false,
      status: 400,
      error: 'missing_opening_text',
      message: 'לאוטומציה אין טקסט להודעת הפתיחה.',
    };
  }

  let opening;
  try {
    opening = await instagram.sendPrivateReply(account, {
      commentId: id,
      igsid,
      message: openingText,
    });
  } catch (err) {
    return {
      ok: false,
      status: 502,
      error: 'send_failed',
      message: err.message || 'שליחת ההודעה נכשלה.',
    };
  }

  const recipient = await db.createRecipient({
    automation_id: matched.id,
    account_id: account.id,
    comment_id: id,
    igsid: opening.recipient_id || igsid,
    username,
    comment_text: text,
    media_id: commentMediaId || null,
    status: 'opening_sent',
    opening_sent_at: nowSql(),
    click_id: randomId(12),
    last_user_interaction_at: nowSql(),
  });
  await db.recordPrivateReply({
    commentId: id,
    accountId: account.id,
    recipientIgsid: opening.recipient_id || igsid,
    messageId: opening.message_id,
  });
  await db.markCommentProcessed({
    commentId: id,
    accountId: account.id,
    automationId: matched.id,
    reason: 'manual_opening_dm',
  });

  return {
    ok: true,
    status: 200,
    message: 'ההודעה נשלחה',
    recipient_id: recipient.id,
    automation_id: matched.id,
    message_id: opening.message_id || null,
    opening,
  };
}

module.exports = {
  collectKeywordCommentAudit,
  authorKeys,
  attachRecipientFlags,
  sendManualOpeningDm,
  loadComment,
};
