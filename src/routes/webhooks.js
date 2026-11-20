const express = require('express');
const { verifyHubSignature } = require('../lib/signatures');

function createWebhookRouter({ db, config, engine }) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === config.meta.verifyToken) {
      return res.status(200).send(String(challenge || ''));
    }
    return res.status(403).send('Forbidden');
  });

  router.post('/', async (req, res) => {
    // Always ACK quickly. Process after.
    res.status(200).send('EVENT_RECEIVED');

    const raw = req.rawBody;
    const skipSig = config.mockMode && (req.headers['x-mock-webhook'] === '1' || !config.meta.appSecret);
    if (!skipSig) {
      const header = req.headers['x-hub-signature-256'];
      if (!verifyHubSignature(raw || Buffer.from(''), header, config.meta.appSecret)) {
        console.warn('[webhook] invalid signature');
        return;
      }
    }

    try {
      await processPayload(req.body, { db, engine });
    } catch (err) {
      console.error('[webhook] processing error', err);
    }
  });

  return router;
}

async function processPayload(body, { db, engine }) {
  if (!body || body.object !== 'instagram') return { ignored: true };
  const results = [];
  for (const entry of body.entry || []) {
    const igUserId = String(entry.id || '');
    const account = igUserId
      ? (db.findAccountByExternalId
          ? await db.findAccountByExternalId(igUserId)
          : (await db.getAccountByIgUserId(igUserId) || (db.getAccountByPageId && await db.getAccountByPageId(igUserId))))
      : null;
    if (!account) {
      results.push({ ignored: true, reason: 'unknown_account', igUserId });
      continue;
    }

    for (const change of entry.changes || []) {
      const field = change.field;
      const value = change.value || {};
      if (field === 'comments' || field === 'live_comments') {
        results.push(await engine.handleComment(account, value, { followerHint: value.is_follower }));
      } else if (field === 'messaging_postbacks' || value.postback) {
        results.push(await engine.handlePostback(account, value));
      } else if (field === 'messages' || value.message) {
        results.push(await engine.handleInboundMessage(account, value));
      }
    }

    for (const ev of entry.messaging || []) {
      if (ev.postback) {
        results.push(await engine.handlePostback(account, ev));
      } else if (ev.message) {
        results.push(await engine.handleInboundMessage(account, ev));
      }
    }
  }
  return results;
}

function mockCommentPayload({ igUserId, commentId, text, mediaId, fromId, fromUsername, isFollower }) {
  return {
    object: 'instagram',
    entry: [
      {
        id: igUserId,
        time: Math.floor(Date.now() / 1000),
        changes: [
          {
            field: 'comments',
            value: {
              id: commentId,
              text,
              from: { id: fromId, username: fromUsername },
              media: { id: mediaId, media_product_type: 'REELS' },
              is_follower: isFollower,
            },
          },
        ],
      },
    ],
  };
}

function mockPostbackPayload({ igUserId, senderId, payload, title }) {
  return {
    object: 'instagram',
    entry: [
      {
        id: igUserId,
        time: Math.floor(Date.now() / 1000),
        messaging: [
          {
            sender: { id: senderId },
            recipient: { id: igUserId },
            timestamp: Date.now(),
            postback: { title, payload },
          },
        ],
      },
    ],
  };
}

function mockMessagePayload({ igUserId, senderId, text }) {
  return {
    object: 'instagram',
    entry: [
      {
        id: igUserId,
        time: Math.floor(Date.now() / 1000),
        messaging: [
          {
            sender: { id: senderId },
            recipient: { id: igUserId },
            timestamp: Date.now(),
            message: { mid: `mid_${Date.now()}`, text },
          },
        ],
      },
    ],
  };
}

module.exports = {
  createWebhookRouter,
  processPayload,
  mockCommentPayload,
  mockPostbackPayload,
  mockMessagePayload,
};
