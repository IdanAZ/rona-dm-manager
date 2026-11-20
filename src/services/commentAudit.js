const {
  DEFAULT_KEYWORD,
  DEFAULT_CAPTION_PREFIX,
  buildAudit,
} = require('../lib/audit');

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

module.exports = { collectKeywordCommentAudit, authorKeys };
