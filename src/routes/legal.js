const crypto = require('crypto');
const express = require('express');
const { nowSql } = require('../db');

function base64UrlDecode(input) {
  const padded = String(input).replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(padded, 'base64');
}

function parseSignedRequest(signedRequest, secret) {
  if (!signedRequest || !secret) return null;
  const parts = String(signedRequest).split('.', 2);
  if (parts.length !== 2) return null;
  const [encodedSig, payload] = parts;
  const sig = base64UrlDecode(encodedSig);
  const expected = crypto.createHmac('sha256', secret).update(payload).digest();
  if (sig.length !== expected.length || !crypto.timingSafeEqual(sig, expected)) return null;
  try {
    return JSON.parse(base64UrlDecode(payload).toString('utf8'));
  } catch {
    return null;
  }
}

function confirmationCode() {
  return crypto.randomBytes(8).toString('hex');
}

function createLegalRouter({ db, config }) {
  const router = express.Router();

  router.post('/data-deletion', async (req, res, next) => {
    try {
      const signed = req.body?.signed_request || req.body?.signedRequest;
      if (!signed) {
        return res.status(400).json({ error: 'missing_signed_request' });
      }
      const secret = config?.meta?.appSecret || '';
      const parsed = parseSignedRequest(signed, secret);
      if (!parsed || !parsed.user_id) {
        return res.status(400).json({ error: 'invalid_signed_request' });
      }
      const code = confirmationCode();
      if (db && typeof db.createDeletionRequest === 'function') {
        await db.createDeletionRequest({
          confirmationCode: code,
          fbUserId: String(parsed.user_id),
          status: 'received',
        });
        if (typeof db.deletePlatformDataForFacebookUser === 'function') {
          await db.deletePlatformDataForFacebookUser(String(parsed.user_id));
          await db.updateDeletionRequest(code, { status: 'completed', completedAt: nowSql() });
        }
      }
      const base = String(config?.appUrl || '').replace(/\/$/, '');
      res.json({
        url: `${base}/data-deletion/status/${encodeURIComponent(code)}`,
        confirmation_code: code,
      });
    } catch (err) {
      next(err);
    }
  });

  router.get('/data-deletion/status/:code', async (req, res, next) => {
    try {
      const code = String(req.params.code || '').trim();
      const row = db && db.getDeletionRequest ? await db.getDeletionRequest(code) : null;
      const status = row?.status || 'not_found';
      const when = row?.completed_at || row?.created_at || '';
      res.type('html').send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Deletion request status</title>
<link rel="stylesheet" href="/legal.css"></head>
<body><main>
  <h1>Data deletion request</h1>
  <p>Confirmation code: <b>${code.replace(/[<>&]/g, '')}</b></p>
  <p>Status: <b>${String(status)}</b>${when ? ` (${when} UTC)` : ''}</p>
  <p><a href="/data-deletion">Back to deletion instructions</a></p>
</main></body></html>`);
    } catch (err) { next(err); }
  });

  return router;
}

module.exports = { createLegalRouter, parseSignedRequest };
