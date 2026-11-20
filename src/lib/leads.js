const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'converted', 'closed', 'ignored'];
const LEAD_SOURCES = ['comment', 'dm', 'manual', 'import'];

const LEAD_STATUS_LABELS = {
  new: 'חדש',
  contacted: 'נוצר קשר',
  qualified: 'מעוניינת',
  converted: 'הושלם',
  closed: 'נסגר',
  ignored: 'לא רלוונטי',
};

const LEAD_SOURCE_LABELS = {
  comment: 'תגובה',
  dm: 'הודעה פרטית',
  manual: 'ידני',
  import: 'ייבוא',
};

function normalizeLeadStatus(value, fallback = 'new') {
  const s = String(value || '').toLowerCase();
  return LEAD_STATUSES.includes(s) ? s : fallback;
}

function normalizeLeadSource(value, fallback = 'comment') {
  const s = String(value || '').toLowerCase();
  return LEAD_SOURCES.includes(s) ? s : fallback;
}

function parseLeadFields(raw) {
  if (!raw) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return { ...raw };
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Map an automation recipient row onto a generic lead status.
 * Designed so future flows (name / week / region collected from DM replies)
 * can live in lead.fields without changing the funnel shape.
 */
function statusFromRecipient(recipient, fields = {}) {
  if (!recipient) return 'new';
  if (recipient.clicked_at || recipient.status === 'clicked' || recipient.status === 'clicked_after_followup') {
    return 'converted';
  }
  if (fields.converted || fields.status === 'converted') return 'converted';
  if (recipient.button_pressed_at || recipient.status === 'button_pressed' || recipient.status === 'second_sent') {
    return 'qualified';
  }
  if (recipient.opening_sent_at || recipient.dm_sent_at || recipient.status === 'opening_sent') {
    return 'contacted';
  }
  if (recipient.status === 'comment_only' || recipient.status === 'skipped_not_follower' || recipient.status === 'window_expired') {
    return 'closed';
  }
  return 'new';
}

function isHandledByOwner(recipient) {
  if (!recipient) return false;
  if (recipient.status === 'comment_only') return true;
  const publicOk = !!(recipient.public_reply_sent_at);
  const dmOk = !!(recipient.opening_sent_at || recipient.dm_sent_at);
  return publicOk && !dmOk;
}

function recipientToLeadDraft(recipient, { accountId } = {}) {
  const fields = {};
  if (recipient.email) fields.email = recipient.email;
  if (recipient.comment_text) fields.comment_text = recipient.comment_text;
  return {
    account_id: accountId || recipient.account_id,
    automation_id: recipient.automation_id || null,
    recipient_id: recipient.id || null,
    source: 'comment',
    status: statusFromRecipient(recipient, fields),
    username: recipient.username || null,
    igsid: recipient.igsid || null,
    comment_id: recipient.comment_id || null,
    fields,
  };
}

function buildAutomationFunnel(automation, { recipients = [], leads = [] } = {}) {
  const autoId = automation?.id;
  const recs = (recipients || []).filter((r) => Number(r.automation_id) === Number(autoId));
  const autoLeads = (leads || []).filter((l) => Number(l.automation_id) === Number(autoId));

  const commentsMatched = Math.max(
    recs.length,
    autoLeads.filter((l) => l.source === 'comment').length
  );
  const sent = recs.filter((r) => r.opening_sent_at || r.dm_sent_at).length
    || autoLeads.filter((l) => ['contacted', 'qualified', 'converted'].includes(l.status)).length;
  const handledByOwner = recs.filter(isHandledByOwner).length
    || autoLeads.filter((l) => l.status === 'closed' && parseLeadFields(l.fields).handled_by_owner).length;
  const qualified = recs.filter((r) => r.button_pressed_at || r.status === 'button_pressed' || r.status === 'second_sent').length
    || autoLeads.filter((l) => l.status === 'qualified' || l.status === 'converted').length;
  const converted = recs.filter((r) => r.clicked_at).length
    || autoLeads.filter((l) => l.status === 'converted').length;

  const seriesMap = new Map();
  const bump = (when, key) => {
    if (!when) return;
    const day = String(when).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}/.test(day)) return;
    const row = seriesMap.get(day) || { date: day, comments: 0, sent: 0, converted: 0 };
    row[key] += 1;
    seriesMap.set(day, row);
  };
  for (const r of recs) {
    bump(r.created_at, 'comments');
    bump(r.opening_sent_at || r.dm_sent_at, 'sent');
    bump(r.clicked_at, 'converted');
  }
  if (!recs.length) {
    for (const l of autoLeads) {
      bump(l.created_at, 'comments');
      if (['contacted', 'qualified', 'converted'].includes(l.status)) bump(l.updated_at || l.created_at, 'sent');
      if (l.status === 'converted') bump(l.updated_at || l.created_at, 'converted');
    }
  }

  return {
    automation_id: autoId,
    name: automation?.name || '',
    keywords: automation?.keywords || '',
    keyword_mode: automation?.keyword_mode || 'keywords',
    status: automation?.status || 'paused',
    comments_matched: commentsMatched,
    sent,
    handled_by_owner: handledByOwner,
    qualified,
    converted,
    conversion_rate: commentsMatched ? Math.round((converted / commentsMatched) * 1000) / 10 : 0,
    series: [...seriesMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };
}

function buildFunnels(automations, ctx) {
  return (automations || []).map((a) => buildAutomationFunnel(a, ctx));
}

module.exports = {
  LEAD_STATUSES,
  LEAD_SOURCES,
  LEAD_STATUS_LABELS,
  LEAD_SOURCE_LABELS,
  normalizeLeadStatus,
  normalizeLeadSource,
  parseLeadFields,
  statusFromRecipient,
  isHandledByOwner,
  recipientToLeadDraft,
  buildAutomationFunnel,
  buildFunnels,
};
