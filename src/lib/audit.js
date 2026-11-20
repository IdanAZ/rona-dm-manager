const { normalize } = require('./keywords');

const PRIVATE_REPLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const JERUSALEM_TZ = 'Asia/Jerusalem';
const DEFAULT_KEYWORD = 'הכנה';
const DEFAULT_CAPTION_PREFIX = 'הגיבי "הכנה" ואשלח לך את כל הפרטים';

const QUOTE_RE = /[\u201C\u201D\u201E\u201F\u00AB\u00BB\u05F4\u2033\u0022\u0027\u2018\u2019\u05F3]/g;

function unifyQuotes(s) {
  return String(s || '').replace(QUOTE_RE, '"');
}

function normalizeCaption(s) {
  return normalize(unifyQuotes(s));
}

function captionStartsWith(caption, prefix) {
  if (!prefix) return false;
  const cap = normalizeCaption(caption);
  const pre = normalizeCaption(prefix);
  if (!pre) return false;
  if (cap.startsWith(pre)) return true;
  // allow a slightly shorter prefix if the live caption continues with an emoji/heart
  const compactCap = compactLetters(caption);
  const compactPre = compactLetters(prefix);
  return compactCap.startsWith(compactPre);
}

function compactLetters(s) {
  return normalize(unifyQuotes(s)).replace(/[^\p{L}\p{N}]+/gu, '');
}

function matchesAuditKeyword(text, keyword) {
  const k = normalize(keyword || DEFAULT_KEYWORD);
  if (!k) return false;
  const t = normalize(text);
  if (!t) return false;
  if (t.includes(k)) return true;
  const compactT = compactLetters(text);
  const compactK = compactLetters(k);
  return Boolean(compactK && compactT.includes(compactK));
}

function parseTime(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const s = String(value).trim();
  const ms = Date.parse(s) || Date.parse(s.replace(' ', 'T').replace(/(\+\d{4})$/, (m) => m.slice(0, 3) + ':' + m.slice(3)));
  if (Number.isNaN(ms)) return null;
  return new Date(ms);
}

function formatJerusalem(value) {
  const d = parseTime(value);
  if (!d) return null;
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: JERUSALEM_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  return `${fmt.format(d)} Asia/Jerusalem`;
}

function ageDays(value, now = new Date()) {
  const d = parseTime(value);
  if (!d) return null;
  const n = parseTime(now) || new Date();
  return Math.round(((n.getTime() - d.getTime()) / 86400000) * 10) / 10;
}

function isWithinPrivateReplyWindow(value, now = new Date()) {
  const d = parseTime(value);
  if (!d) return false;
  const n = parseTime(now) || new Date();
  const delta = n.getTime() - d.getTime();
  return delta >= 0 && delta < PRIVATE_REPLY_WINDOW_MS;
}

function identKey(value) {
  return String(value || '').trim().toLowerCase();
}

function isSameAccount(person, account) {
  if (!person || !account) return false;
  const usernames = [account.username, account.name].map(identKey).filter(Boolean);
  const ids = [account.ig_user_id, account.page_id].map((x) => String(x || '')).filter(Boolean);
  if (person.username && usernames.includes(identKey(person.username))) return true;
  if (person.id && ids.includes(String(person.id))) return true;
  return false;
}

function commentAuthor(comment) {
  const from = comment.from || {};
  return {
    id: from.id || comment.from_id || comment.user_id || null,
    username: from.username || comment.username || null,
  };
}

function messageAuthor(message) {
  const from = message.from || {};
  return {
    id: from.id || message.from_id || null,
    username: from.username || from.name || null,
  };
}

function messageText(message) {
  if (!message) return '';
  if (typeof message.message === 'string') return message.message;
  if (typeof message.text === 'string') return message.text;
  if (message.message && typeof message.message.text === 'string') return message.message.text;
  return '';
}

function messageHasTemplate(message) {
  const att = message.attachments || message.attachment || message.shares;
  if (!att) return false;
  const data = att.data || att;
  return Boolean(data && (Array.isArray(data) ? data.length : true));
}

function snippetOf(text, max = 140) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

const AUTOMATED_MARKERS = [
  'manychat',
  'many chat',
  'many-chat',
  'powered by',
  'כן, אשמח',
  'כן אשמח',
  'שמחה שאהבת',
  'שלחתי לך הודעה בפרטי',
  'שולחת לך עכשיו בפרטי',
];

const COURSE_MARKERS = [
  'הכנה',
  'לידה',
  'קורס',
  'פרטים',
  'קישור',
  'לינק',
  'הרשמ',
  'זום',
  'סדנ',
  'הדרכ',
  'אשלח',
  'שמחה שאהבת',
  'כן, אשמח',
  'http://',
  'https://',
  'bit.ly',
  'wa.me',
];

const MANUAL_MARKERS = [
  'תשלום',
  'ביט',
  'העברה',
  'זום',
  'מפגש',
  'תאריך',
  'מחיר',
  'עולים',
  'וואטסאפ',
  'whatsapp',
  'להרשמה',
];

function looksCourseRelated(text) {
  const n = normalize(text);
  if (!n) return false;
  return COURSE_MARKERS.some((m) => n.includes(m) || compactLetters(n).includes(compactLetters(m)));
}

function classifyDmStyle(messages) {
  const texts = (messages || []).map((m) => messageText(m)).filter(Boolean);
  const joined = texts.join('\n');
  const n = normalize(joined);
  let autoScore = 0;
  let manualScore = 0;
  for (const m of AUTOMATED_MARKERS) {
    if (n.includes(m)) autoScore += m.includes('many') || m === 'powered by' ? 3 : 2;
  }
  if ((messages || []).some((m) => messageHasTemplate(m) || m.hasQuickReplies || m.hasTemplate)) autoScore += 2;
  if ((messages || []).some((m) => Array.isArray(m.quick_replies) && m.quick_replies.length)) autoScore += 2;
  if (n.includes('היי') && n.includes('פרטים') && joined.length < 160) autoScore += 1;
  for (const m of MANUAL_MARKERS) {
    if (n.includes(m)) manualScore += 1;
  }
  if (joined.length > 250) manualScore += 1;
  if ((messages || []).length >= 3 && autoScore === 0) manualScore += 1;
  if (autoScore >= 2 && autoScore > manualScore) return 'automated';
  if (manualScore >= 2 && manualScore > autoScore) return 'manual';
  if (autoScore === 0 && manualScore === 0) return 'unclear';
  return autoScore >= manualScore ? 'automated' : 'manual';
}

function conversationParticipants(conversation) {
  const raw = conversation?.participants?.data || conversation?.participants || [];
  return (Array.isArray(raw) ? raw : []).map((p) => ({
    id: p.id || p.igs_id || null,
    username: p.username || p.name || null,
  }));
}

function indexConversations(conversations) {
  const byUsername = new Map();
  const byId = new Map();
  for (const conv of conversations || []) {
    for (const p of conversationParticipants(conv)) {
      if (p.username) {
        const key = identKey(p.username);
        if (!byUsername.has(key)) byUsername.set(key, []);
        byUsername.get(key).push(conv);
      }
      if (p.id) {
        const key = String(p.id);
        if (!byId.has(key)) byId.set(key, []);
        byId.get(key).push(conv);
      }
    }
  }
  return { byUsername, byId };
}

function findConversationForCommenter(index, author) {
  if (author?.username && index.byUsername.has(identKey(author.username))) {
    return index.byUsername.get(identKey(author.username))[0];
  }
  if (author?.id && index.byId.has(String(author.id))) {
    return index.byId.get(String(author.id))[0];
  }
  return null;
}

function outgoingAfter(messages, account, afterTime) {
  const afterMs = afterTime ? afterTime.getTime() : 0;
  return (messages || []).filter((m) => {
    if (!isSameAccount(messageAuthor(m), account)) return false;
    const t = parseTime(m.created_time || m.timestamp);
    if (!t) return false;
    return t.getTime() >= afterMs;
  });
}

function outgoingBefore(messages, account, beforeTime) {
  const beforeMs = beforeTime ? beforeTime.getTime() : 0;
  return (messages || []).filter((m) => {
    if (!isSameAccount(messageAuthor(m), account)) return false;
    const t = parseTime(m.created_time || m.timestamp);
    if (!t) return false;
    return t.getTime() < beforeMs;
  });
}

function publicReplyFromAccount(comment, account) {
  const replies = comment.replies || comment.reply_list || [];
  return (replies || []).filter((r) => isSameAccount(commentAuthor(r), account));
}

function classifyComment({ comment, account, conversation, conversationsAvailable, now }) {
  const author = commentAuthor(comment);
  const commentedAt = parseTime(comment.timestamp);
  const publicReplies = publicReplyFromAccount(comment, account);
  const base = {
    comment_id: comment.id,
    parent_id: comment.parent_id || null,
    is_reply: Boolean(comment.parent_id),
    username: author.username || null,
    igsid: author.id || null,
    comment_text: comment.text || '',
    timestamp: comment.timestamp || null,
    timestamp_jerusalem: formatJerusalem(commentedAt),
    age_days: ageDays(commentedAt, now),
    within_private_reply_window: isWithinPrivateReplyWindow(commentedAt, now),
    public_reply: publicReplies.length > 0,
    public_reply_snippet: publicReplies[0] ? snippetOf(publicReplies[0].text || publicReplies[0].message) : null,
    dm_status: 'unknown',
    dm_source: null,
    dm_snippet: null,
    dm_after_comment: false,
    prior_dm: false,
    content_related: null,
    borderline: false,
    borderline_reason: null,
  };

  if (isSameAccount(author, account)) {
    return { ...base, dm_status: 'skipped_own_comment', borderline: false };
  }

  if (!conversationsAvailable) {
    return {
      ...base,
      dm_status: 'unknown',
      borderline: true,
      borderline_reason: 'conversations_unavailable',
    };
  }

  const messages = conversation?.messages || [];
  const after = commentedAt ? outgoingAfter(messages, account, commentedAt) : [];
  const before = commentedAt ? outgoingBefore(messages, account, commentedAt) : [];
  const relatedAfter = after.filter((m) => looksCourseRelated(messageText(m)) || messageHasTemplate(m));
  const firstRelevant = relatedAfter[0] || after[0] || null;

  base.prior_dm = before.length > 0;
  base.dm_after_comment = after.length > 0;
  base.content_related = after.length ? relatedAfter.length > 0 : null;
  base.dm_snippet = firstRelevant ? snippetOf(messageText(firstRelevant)) : (after[0] ? snippetOf(messageText(after[0])) : null);
  if (after.length) {
    base.dm_source = classifyDmStyle(after);
    base.dm_status = 'already_got_dm';
    if (!relatedAfter.length) {
      base.borderline = true;
      base.borderline_reason = 'unrelated_content';
    }
    return base;
  }

  if (base.prior_dm) {
    base.borderline = true;
    base.borderline_reason = 'prior_dm_only';
    const lastPrior = before[before.length - 1];
    base.dm_source = classifyDmStyle(before);
    base.dm_snippet = lastPrior ? snippetOf(messageText(lastPrior)) : null;
    base.content_related = looksCourseRelated(before.map(messageText).join('\n'));
  }

  base.dm_status = base.within_private_reply_window ? 'eligible_private_reply' : 'not_eligible';
  return base;
}

function buildAudit({ media, comments, conversations, account, keyword, now, conversationsAvailable = true, matchComment } = {}) {
  const kw = keyword || DEFAULT_KEYWORD;
  const when = parseTime(now) || new Date();
  const index = indexConversations(conversations);
  const matched = [];
  for (const comment of comments || []) {
    const text = comment.text || '';
    const matchedText = typeof matchComment === 'function' ? matchComment(text) : matchesAuditKeyword(text, kw);
    if (!matchedText) continue;
    const author = commentAuthor(comment);
    const item = classifyComment({
      comment,
      account,
      conversation: findConversationForCommenter(index, author),
      conversationsAvailable,
      now: when,
    });
    if (item.dm_status === 'skipped_own_comment') continue;
    matched.push(item);
  }

  const groups = {
    already_got_dm: matched.filter((i) => i.dm_status === 'already_got_dm'),
    eligible_private_reply: matched.filter((i) => i.dm_status === 'eligible_private_reply'),
    not_eligible: matched.filter((i) => i.dm_status === 'not_eligible'),
    unknown_dm: matched.filter((i) => i.dm_status === 'unknown'),
    borderline: matched.filter((i) => i.borderline),
  };

  return {
    keyword: kw,
    generated_at: formatJerusalem(when),
    media: media
      ? {
          id: media.id,
          caption: media.caption || null,
          permalink: media.permalink || null,
          timestamp: media.timestamp || null,
          timestamp_jerusalem: formatJerusalem(media.timestamp),
          comments_count: media.comments_count ?? null,
          media_type: media.media_type || media.media_product_type || null,
        }
      : null,
    counts: {
      total: matched.length,
      already_got_dm: groups.already_got_dm.length,
      eligible_private_reply: groups.eligible_private_reply.length,
      not_eligible: groups.not_eligible.length,
      unknown_dm: groups.unknown_dm.length,
      borderline: groups.borderline.length,
      public_replies: matched.filter((i) => i.public_reply).length,
    },
    groups,
    items: matched,
    conversations_available: conversationsAvailable,
  };
}

module.exports = {
  PRIVATE_REPLY_WINDOW_MS,
  DEFAULT_KEYWORD,
  DEFAULT_CAPTION_PREFIX,
  unifyQuotes,
  normalizeCaption,
  captionStartsWith,
  matchesAuditKeyword,
  formatJerusalem,
  ageDays,
  isWithinPrivateReplyWindow,
  looksCourseRelated,
  classifyDmStyle,
  classifyComment,
  buildAudit,
  snippetOf,
  isSameAccount,
  publicReplyFromAccount,
  commentAuthor,
};
