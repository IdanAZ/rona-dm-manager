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
  const mediaId = query.mediaId || query.media_id || '';
  const keyword = query.keyword || DEFAULT_KEYWORD;
  const explicitPrefix = query.captionPrefix != null ? query.captionPrefix : query.caption_prefix;
  // When a media id is provided, do not fall back to the הכנה caption prefix.
  const captionPrefix = mediaId
    ? (explicitPrefix || '')
    : (explicitPrefix || DEFAULT_CAPTION_PREFIX);
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
    matchComment: query.matchComment,
  });

  return {
    ok: true,
    ...audit,
    caption_prefix: captionPrefix,
    errors,
    tried_endpoints: tried,
  };
}



function tagAuditItems(result, automation, media) {
  if (!result || !Array.isArray(result.items)) return result;
  const mediaInfo = media || result.media || null;
  for (const item of result.items) {
    item.automation_id = automation.id;
    item.automation_name = automation.name;
    item.media_id = automation.media_id || mediaInfo?.id || item.media_id || null;
    item.media_permalink = automation.media_permalink || mediaInfo?.permalink || item.media_permalink || null;
    item.media_caption = automation.media_caption || mediaInfo?.caption || item.media_caption || null;
  }
  return result;
}

async function collectAutomationAudit(instagram, account, automation, query = {}) {
  const result = await collectKeywordCommentAudit(instagram, account, {
    mediaId: automation.media_id,
    captionPrefix: '',
    keyword: query.keyword || automation.keywords || DEFAULT_KEYWORD,
    now: query.now,
    matchComment: (text) => matchesComment({
      text,
      keywordMode: automation.keyword_mode,
      keywords: automation.keywords,
      matchType: automation.match_type,
    }),
  });
  return tagAuditItems(result, automation, result.media);
}

async function collectAutomationsCommentAudit(instagram, account, query = {}) {
  const db = query.db;
  if (!db) {
    return collectKeywordCommentAudit(instagram, account, query);
  }
  const rawId = query.automationId || query.automation_id || 'all';
  let automations;
  if (rawId && String(rawId) !== 'all') {
    const auto = await db.getAutomation(rawId);
    if (!auto || Number(auto.account_id) !== Number(account.id)) {
      return {
        ok: false,
        error: 'automation_not_found',
        message: 'האוטומציה לא נמצאה.',
        items: [],
        groups: {},
        counts: { total: 0 },
        errors: [],
      };
    }
    automations = [auto];
  } else {
    automations = (await db.listAutomations(account.id)).filter((a) => a.media_id);
  }

  const items = [];
  const errors = [];
  const scanned = [];
  const seen = new Set();
  for (const automation of automations) {
    const one = await collectAutomationAudit(instagram, account, automation, query);
    if (one.errors && one.errors.length) errors.push(...one.errors);
    scanned.push({
      id: automation.id,
      name: automation.name,
      media_id: automation.media_id,
      media_permalink: automation.media_permalink || one.media?.permalink || null,
      media_caption: automation.media_caption || one.media?.caption || null,
      ok: !!one.ok,
      error: one.ok ? null : (one.error || one.message || null),
    });
    if (!one.ok && one.error && one.error !== 'media_not_found') {
      // still surface any items if present
    }
    for (const item of one.items || []) {
      const key = String(item.comment_id);
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(item);
    }
  }

  const result = {
    ok: true,
    keyword: query.keyword || null,
    automation_id: String(rawId || 'all'),
    automations: scanned,
    media: scanned.length === 1 ? {
      id: scanned[0].media_id,
      caption: scanned[0].media_caption,
      permalink: scanned[0].media_permalink,
    } : null,
    items,
    errors,
  };
  return regroupAuditItems(result);
}

async function collectCommentAudit(instagram, account, query = {}, db) {
  const automationId = query.automationId || query.automation_id;
  if (db && automationId) {
    return collectAutomationsCommentAudit(instagram, account, { ...query, db, automationId });
  }
  return collectKeywordCommentAudit(instagram, account, query);
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

function regroupAuditItems(result) {
  if (!result || !Array.isArray(result.items)) return result;
  const items = result.items;
  const groups = {
    already_got_dm: items.filter((i) => i.dm_status === 'already_got_dm' || i.dm_ok),
    eligible_private_reply: items.filter((i) => i.dm_status === 'eligible_private_reply' && !i.dm_ok),
    not_eligible: items.filter((i) => i.dm_status === 'not_eligible'),
    unknown_dm: items.filter((i) => i.dm_status === 'unknown' && !i.dm_ok),
    borderline: items.filter((i) => i.borderline),
  };
  result.groups = groups;
  result.counts = {
    ...(result.counts || {}),
    total: items.length,
    already_got_dm: groups.already_got_dm.length,
    eligible_private_reply: groups.eligible_private_reply.length,
    not_eligible: groups.not_eligible.length,
    unknown_dm: groups.unknown_dm.length,
    borderline: groups.borderline.length,
    public_replies: items.filter((i) => i.public_reply || i.public_reply_ok).length,
  };
  return result;
}

async function attachRecipientFlags(db, account, result) {
  if (!result || !Array.isArray(result.items) || !db) return result;
  for (const item of result.items) {
    const existing = await db.findRecipientByCommentOrUser({
      accountId: account.id,
      commentId: item.comment_id,
      igsid: item.igsid,
      username: item.username,
      automationId: item.automation_id,
    }) || await db.findRecipientByCommentOrUser({
      accountId: account.id,
      commentId: item.comment_id,
      igsid: item.igsid,
      username: item.username,
    });
    const publicRow = db.getPublicReply ? await db.getPublicReply(item.comment_id) : null;
    const appPublic = !!(publicRow && publicRow.status === 'sent')
      || !!(existing && existing.public_reply_sent_at && String(existing.comment_id) === String(item.comment_id));
    const igPublic = !!item.public_reply;
    const publicOk = igPublic || appPublic;
    const dmOk = !!(existing && (existing.dm_sent_at || existing.opening_sent_at))
      || item.dm_status === 'already_got_dm';

    item.already_recorded = !!existing;
    item.recipient_id = existing?.id || null;
    item.public_reply = publicOk;
    item.public_reply_ok = publicOk;
    item.dm_ok = dmOk;
    item.app_public_reply = appPublic;
    item.can_send = !!item.within_private_reply_window && !dmOk && item.dm_status !== 'not_eligible';
    item.can_send_public_reply = !publicOk;
    if (dmOk && item.dm_status !== 'already_got_dm') {
      item.dm_status = 'already_got_dm';
    }
  }
  return regroupAuditItems(result);
}

async function sendManualOpeningDm({ db, instagram, engine, account, commentId, mediaId, now } = {}) {
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
  const publicRow = db.getPublicReply ? await db.getPublicReply(id) : null;
  const hasPublic = !!(publicRow && publicRow.status === 'sent') || !!(existing && existing.public_reply_sent_at && String(existing.comment_id) === id);
  const hasDm = !!(existing && (existing.dm_sent_at || existing.opening_sent_at)) || (await db.hasPrivateReply(id));
  if (hasDm && hasPublic) {
    return {
      ok: false,
      status: 409,
      error: 'already_sent',
      message: 'ההודעה כבר נשלחה לנמענת הזו.',
      recipient_id: existing?.id || null,
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

  if (!engine || typeof engine.handleComment !== 'function') {
    return { ok: false, status: 500, error: 'engine_unavailable', message: 'מנוע השליחה לא זמין.' };
  }

  const handled = await engine.handleComment(account, {
    id,
    text,
    media: { id: commentMediaId },
    media_id: commentMediaId,
    from: comment.from || { id: igsid, username },
    replies: comment.replies || [],
  }, {
    source: 'manual',
    automation: matched,
    comment: { ...comment, media: comment.media || { id: commentMediaId } },
    now: when,
  });

  if (handled.skipped && handled.reason === 'already_recipient' && hasDm && hasPublic) {
    return {
      ok: false,
      status: 409,
      error: 'already_sent',
      message: 'ההודעה כבר נשלחה לנמענת הזו.',
      recipient_id: handled.recipientId || existing?.id || null,
    };
  }
  if (handled.ok === false) {
    return {
      ok: false,
      status: 502,
      error: 'send_failed',
      message: handled.error || 'שליחת ההודעה נכשלה.',
      recipient_id: handled.recipientId || null,
    };
  }

  const recipient = handled.recipientId ? await db.getRecipient(handled.recipientId) : existing;
  return {
    ok: true,
    status: 200,
    message: 'ההודעה נשלחה',
    recipient_id: recipient?.id || handled.recipientId || null,
    automation_id: matched.id,
    message_id: handled.opening?.message_id || null,
    public_reply: handled.publicReply || null,
    opening: handled.opening,
  };
}

async function sendMissingPublicReply({ db, instagram, engine, account, commentId, mediaId, now } = {}) {
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

  const igsid = String(comment.from?.id || comment.from_id || '');
  const username = comment.username || comment.from?.username || '';
  const commentMediaId = String(comment.media?.id || mediaId || '');
  const { publicReplyFromAccount, isSameAccount, commentAuthor } = require('../lib/audit');
  if (isSameAccount(commentAuthor(comment), account)) {
    return { ok: false, status: 400, error: 'own_comment', message: 'לא שולחים תגובה על תגובה של רונה.' };
  }
  if (publicReplyFromAccount(comment, account).length || (db.hasPublicReply && await db.hasPublicReply(id))) {
    return {
      ok: false,
      status: 409,
      error: 'already_replied',
      message: 'כבר יש תגובה ציבורית על התגובה הזו.',
    };
  }

  const existing = await db.findRecipientByCommentOrUser({
    accountId: account.id,
    commentId: id,
    igsid,
    username,
  });
  const live = await db.listLiveAutomationsForAccount(account.id);
  const matched = live.find((auto) => {
    if (!automationMatchesMedia(auto, commentMediaId)) return false;
    return matchesComment({
      text: comment.text || '',
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
  if (!engine || typeof engine.handleComment !== 'function') {
    return { ok: false, status: 500, error: 'engine_unavailable', message: 'מנוע השליחה לא זמין.' };
  }

  const handled = await engine.handleComment(account, {
    id,
    text: comment.text || '',
    media: { id: commentMediaId },
    media_id: commentMediaId,
    from: comment.from || { id: igsid, username },
    replies: comment.replies || [],
  }, {
    source: 'manual',
    automation: matched,
    comment: { ...comment, media: comment.media || { id: commentMediaId } },
    now: now || new Date(),
  });

  const publicOk = !!(handled.publicReply) || (db.hasPublicReply && await db.hasPublicReply(id));
  if (!publicOk && handled.ok === false) {
    return {
      ok: false,
      status: 502,
      error: 'send_failed',
      message: handled.error || 'שליחת התגובה הציבורית נכשלה.',
      recipient_id: handled.recipientId || existing?.id || null,
    };
  }
  if (!publicOk && handled.skipped && handled.reason === 'already_recipient') {
    return {
      ok: false,
      status: 409,
      error: 'already_replied',
      message: 'כבר יש תגובה ציבורית על התגובה הזו.',
      recipient_id: handled.recipientId || existing?.id || null,
    };
  }
  return {
    ok: true,
    status: 200,
    message: 'התגובה בפוסט נשלחה',
    recipient_id: handled.recipientId || existing?.id || null,
    automation_id: matched.id,
    public_reply: handled.publicReply || null,
  };
}


module.exports = {
  collectKeywordCommentAudit,
  collectAutomationsCommentAudit,
  collectCommentAudit,
  authorKeys,
  attachRecipientFlags,
  regroupAuditItems,
  sendManualOpeningDm,
  sendMissingPublicReply,
  loadComment,
};
