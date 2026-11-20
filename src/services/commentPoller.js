const { matchesComment } = require('../lib/keywords');
const {
  isWithinPrivateReplyWindow,
  publicReplyFromAccount,
  isSameAccount,
  commentAuthor,
} = require('../lib/audit');

function isPollerEnabled(account) {
  if (!account) return false;
  return account.comment_poller_enabled === undefined
    || account.comment_poller_enabled === null
    || Number(account.comment_poller_enabled) !== 0;
}

function uniqueComments(comments) {
  const byId = new Map();
  for (const comment of comments || []) {
    if (!comment || !comment.id) continue;
    const id = String(comment.id);
    const prev = byId.get(id);
    if (!prev || (comment.replies && comment.replies.length && !(prev.replies && prev.replies.length))) {
      byId.set(id, comment);
    }
  }
  return [...byId.values()];
}

function hasIgPublicReply(comment, account) {
  return publicReplyFromAccount(comment, account).length > 0;
}

function recipientHasDm(recipient) {
  if (!recipient) return false;
  return !!(recipient.dm_sent_at || recipient.opening_sent_at);
}

async function classifyNeed({ db, account, automation, comment, now }) {
  const author = commentAuthor(comment);
  if (isSameAccount(author, account)) return { action: 'skip', reason: 'self_comment' };
  if (!matchesComment({
    text: comment.text || '',
    keywordMode: automation.keyword_mode,
    keywords: automation.keywords,
    matchType: automation.match_type,
  })) {
    return { action: 'skip', reason: 'no_match' };
  }

  const commentId = String(comment.id);
  const igsid = author.id ? String(author.id) : '';
  const username = author.username || '';
  const recipient = await db.findRecipientByCommentOrUser({
    accountId: account.id,
    commentId,
    igsid,
    username,
    automationId: automation.id,
  }) || await db.findRecipientByCommentOrUser({
    accountId: account.id,
    commentId,
    igsid,
    username,
  });

  const appPublic = await db.hasPublicReply(commentId);
  const igPublic = hasIgPublicReply(comment, account);
  const hasPublic = appPublic || igPublic;
  const hasDm = recipientHasDm(recipient)
    || (await db.hasPrivateReply(commentId));
  const withinWindow = isWithinPrivateReplyWindow(comment.timestamp, now);
  const dmExhausted = recipient
    && recipient.status === 'failed'
    && Number(recipient.send_attempts || 0) >= 2
    && !hasDm;
  const publicRow = await db.getPublicReply(commentId);
  const publicExhausted = publicRow
    && publicRow.status === 'failed'
    && Number(publicRow.attempts || 0) >= 2
    && !hasPublic;

  // Full send: new keyword comment, no recipient, within 7 days, no public reply from Rona/app.
  if (!recipient && !hasPublic && withinWindow && !hasDm) {
    return { action: 'both', reason: 'need_message', recipient };
  }
  // DM was sent but no public reply from the app or Rona → post the missing public reply once.
  if (hasDm && !hasPublic && !publicExhausted) {
    return { action: 'public', reason: 'missing_public_reply', recipient };
  }
  // Public reply recorded by the app, but DM is missing → send the opening DM.
  if (!hasDm && appPublic && withinWindow && !dmExhausted) {
    return { action: 'dm', reason: 'missing_dm', recipient };
  }
  if (recipient && recipient.status === 'failed' && !dmExhausted && withinWindow && !hasDm) {
    return { action: 'dm', reason: 'retry_dm', recipient };
  }
  return { action: 'skip', reason: 'no_need', recipient, hasPublic, hasDm };
}

async function pollComments({ db, instagram, engine, config, now } = {}) {
  const when = now || new Date();
  const results = [];
  const accounts = await db.listAccountsWithTokens();
  for (const account of accounts) {
    if (!isPollerEnabled(account)) {
      results.push({ accountId: account.id, skipped: true, reason: 'poller_disabled' });
      continue;
    }
    let automations = [];
    try {
      automations = await db.listLiveSpecificAutomations(account.id);
    } catch (err) {
      results.push({ accountId: account.id, ok: false, error: err.message });
      continue;
    }
    for (const automation of automations) {
      let comments = [];
      try {
        comments = uniqueComments(await instagram.listMediaComments(account, automation.media_id));
      } catch (err) {
        results.push({
          accountId: account.id,
          automationId: automation.id,
          ok: false,
          error: err.message,
        });
        continue;
      }
      for (const comment of comments) {
        let need;
        try {
          need = await classifyNeed({ db, account, automation, comment, now: when });
        } catch (err) {
          results.push({
            accountId: account.id,
            automationId: automation.id,
            commentId: comment.id,
            ok: false,
            error: err.message,
          });
          continue;
        }
        if (need.action === 'skip') continue;
        try {
          const handled = await engine.handleComment(account, {
            id: comment.id,
            text: comment.text,
            media: { id: automation.media_id },
            media_id: automation.media_id,
            from: comment.from || { id: comment.from_id, username: comment.username },
            replies: comment.replies || [],
          }, {
            source: 'poller',
            automation,
            comment: { ...comment, media: comment.media || { id: automation.media_id } },
            now: when,
          });
          results.push({
            accountId: account.id,
            automationId: automation.id,
            commentId: comment.id,
            need: need.reason,
            ...handled,
          });
        } catch (err) {
          results.push({
            accountId: account.id,
            automationId: automation.id,
            commentId: comment.id,
            ok: false,
            error: err.message,
          });
        }
      }
    }
  }
  return results;
}

function startCommentPoller({ db, instagram, engine, config }) {
  const interval = Math.max(5000, Number(config.commentPollIntervalMs || 60000) || 60000);
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await pollComments({ db, instagram, engine, config });
    } catch (err) {
      console.warn('[comment-poller]', err.message);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, interval);
  // Kick once after a short delay so boot isn't blocked, but missed webhooks are recovered quickly.
  const starter = setTimeout(tick, 15000);
  if (typeof starter.unref === 'function') starter.unref();
  return {
    timer,
    interval,
    stop() {
      clearInterval(timer);
      clearTimeout(starter);
    },
    runOnce: tick,
  };
}

module.exports = {
  pollComments,
  startCommentPoller,
  classifyNeed,
  isPollerEnabled,
  uniqueComments,
};
