function emailConfigured(config) {
  const s = config?.summary || {};
  const to = String(s.emailTo || '').trim();
  if (!to) return false;
  return !!(s.resendApiKey || s.smtpHost);
}

async function sendViaResend({ apiKey, from, to, subject, text, html }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: Array.isArray(to) ? to : [to],
      subject,
      text,
      html,
    }),
  });
  const body = await res.text();
  let json = {};
  try { json = body ? JSON.parse(body) : {}; } catch { json = { raw: body }; }
  if (!res.ok) {
    const err = new Error(json?.message || `Resend ${res.status}`);
    err.status = res.status;
    err.payload = json;
    throw err;
  }
  return { provider: 'resend', id: json.id || null, payload: json };
}

async function sendViaSmtp(smtp, message) {
  let nodemailer;
  try {
    nodemailer = require('nodemailer');
  } catch {
    const err = new Error('SMTP configured but nodemailer is not installed');
    err.code = 'smtp_unavailable';
    throw err;
  }
  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port || 587,
    secure: !!smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
  });
  const info = await transporter.sendMail({
    from: message.from,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
  return { provider: 'smtp', id: info.messageId || null, payload: info };
}

async function sendEmail(config, message, transport) {
  if (typeof transport === 'function') {
    return transport(message);
  }
  if (!emailConfigured(config)) {
    return { skipped: true, reason: 'email_not_configured' };
  }
  const s = config.summary;
  const payload = {
    from: s.emailFrom || 'Rona <noreply@localhost>',
    to: s.emailTo,
    subject: message.subject,
    text: message.text || '',
    html: message.html || undefined,
  };
  if (s.resendApiKey) {
    return sendViaResend({ apiKey: s.resendApiKey, ...payload });
  }
  return sendViaSmtp({
    host: s.smtpHost,
    port: s.smtpPort,
    secure: s.smtpSecure,
    user: s.smtpUser,
    pass: s.smtpPass,
  }, payload);
}

module.exports = { emailConfigured, sendEmail, sendViaResend, sendViaSmtp };
