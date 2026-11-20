const crypto = require('crypto');

function signHmacSha256(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function verifyHubSignature(rawBody, header, appSecret) {
  if (!appSecret) return false;
  if (!header || typeof header !== 'string') return false;
  const expected = 'sha256=' + signHmacSha256(rawBody, appSecret);
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function randomId(bytes = 24) {
  return crypto.randomBytes(bytes).toString('hex');
}

function signCookie(value, secret) {
  const h = crypto.createHmac('sha256', secret).update(value).digest('hex');
  return `${value}.${h}`;
}

function unsignCookie(signed, secret) {
  if (!signed || !signed.includes('.')) return null;
  const idx = signed.lastIndexOf('.');
  const value = signed.slice(0, idx);
  const hash = signed.slice(idx + 1);
  const expected = crypto.createHmac('sha256', secret).update(value).digest('hex');
  const a = Buffer.from(hash);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return value;
}

module.exports = {
  signHmacSha256,
  verifyHubSignature,
  randomId,
  signCookie,
  unsignCookie,
};
