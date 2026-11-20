const ALLOWED_ACTIONS = [
  'pause_automation',
  'resume_automation',
  'update_automation',
  'create_automation',
  'add_partner',
  'update_partner',
  'update_lead',
  'create_feature_request',
];

const AUTOMATION_PATCH_FIELDS = [
  'name', 'keywords', 'keyword_mode', 'match_type',
  'opening_dm_text', 'opening_dm_button_label', 'opening_dm_enabled',
  'public_reply_enabled', 'public_reply_variants',
  'second_dm_text', 'second_dm_link_url', 'second_dm_link_title',
  'followup_enabled', 'followup_hours', 'followup_text',
  'must_follow', 'collect_email', 'status',
];

const PARTNER_FIELDS = [
  'name', 'handle', 'category', 'why_relevant', 'email', 'phone', 'website', 'status', 'notes',
];

const LEAD_FIELDS = ['status', 'fields', 'username'];

const ACTION_LABELS = {
  pause_automation: 'השהיית אוטומציה',
  resume_automation: 'הפעלת אוטומציה',
  update_automation: 'עדכון אוטומציה',
  create_automation: 'יצירת אוטומציה',
  add_partner: 'הוספת שותפה',
  update_partner: 'עדכון שותפה',
  update_lead: 'עדכון ליד',
  create_feature_request: 'שמירת בקשת שיפור',
};

function isAllowedAction(action) {
  return ALLOWED_ACTIONS.includes(String(action || ''));
}

function toolDefinitions() {
  return [
    {
      type: 'function',
      function: {
        name: 'propose_pause_automation',
        description: 'Propose pausing (not executing) an existing automation. Requires user confirmation.',
        parameters: {
          type: 'object',
          properties: {
            automation_id: { type: 'number' },
            name_hint: { type: 'string', description: 'Automation name if id is unknown' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'propose_resume_automation',
        description: 'Propose resuming a paused automation. Requires user confirmation.',
        parameters: {
          type: 'object',
          properties: {
            automation_id: { type: 'number' },
            name_hint: { type: 'string' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'propose_update_automation',
        description: 'Propose updating fields of an automation such as keywords or reply text. Requires confirmation. Never send messages.',
        parameters: {
          type: 'object',
          properties: {
            automation_id: { type: 'number' },
            name_hint: { type: 'string' },
            fields: { type: 'object' },
          },
          required: ['fields'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'propose_create_automation',
        description: 'Propose creating a new automation. It will be created paused until the owner enables it. Requires confirmation.',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            keywords: { type: 'string' },
            opening_dm_text: { type: 'string' },
            public_reply_variants: { type: 'array', items: { type: 'string' } },
            opening_dm_button_label: { type: 'string' },
          },
          required: ['name'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'propose_add_partner',
        description: 'Propose adding a collaboration partner. The app will not send outreach. Requires confirmation.',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            handle: { type: 'string' },
            category: { type: 'string' },
            why_relevant: { type: 'string' },
            email: { type: 'string' },
            phone: { type: 'string' },
            website: { type: 'string' },
            notes: { type: 'string' },
          },
          required: ['name'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'propose_update_partner',
        description: 'Propose updating a collaboration partner. Requires confirmation.',
        parameters: {
          type: 'object',
          properties: {
            partner_id: { type: 'number' },
            handle_hint: { type: 'string' },
            fields: { type: 'object' },
          },
          required: ['fields'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'propose_update_lead',
        description: 'Propose updating a lead status or fields (name/week/region). Requires confirmation.',
        parameters: {
          type: 'object',
          properties: {
            lead_id: { type: 'number' },
            username_hint: { type: 'string' },
            status: { type: 'string' },
            fields: { type: 'object' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'propose_feature_request',
        description: 'When the user wants a change to the app itself (not her Instagram data), propose saving a feature request. Requires confirmation. Never modify code.',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            body: { type: 'string' },
          },
          required: ['body'],
        },
      },
    },
  ];
}

function findByName(list, hint, fields = ['name']) {
  const q = String(hint || '').trim().toLowerCase().replace(/^@/, '');
  if (!q || !list) return null;
  return list.find((item) => fields.some((f) => String(item[f] || '').toLowerCase().includes(q))) || null;
}

function pickAutomation(payload, automations) {
  if (payload.automation_id) {
    const found = automations.find((a) => Number(a.id) === Number(payload.automation_id));
    if (found) return found;
  }
  return findByName(automations, payload.name_hint || payload.name, ['name']);
}

function sanitizeAutomationFields(fields) {
  const out = {};
  if (!fields || typeof fields !== 'object') return out;
  for (const key of AUTOMATION_PATCH_FIELDS) {
    if (fields[key] === undefined) continue;
    out[key] = fields[key];
  }
  if (out.status && !['live', 'paused'].includes(String(out.status))) delete out.status;
  if (Array.isArray(out.public_reply_variants)) {
    out.public_reply_variants = out.public_reply_variants.map((s) => String(s).trim()).filter(Boolean);
  }
  return out;
}

function sanitizePartnerFields(fields) {
  const out = {};
  if (!fields || typeof fields !== 'object') return out;
  for (const key of PARTNER_FIELDS) {
    if (fields[key] !== undefined) out[key] = fields[key];
  }
  if (out.handle) out.handle = String(out.handle).replace(/^@/, '').trim();
  return out;
}

/**
 * Turn a tool call into a validated proposal payload (not executed).
 */
function proposalFromToolCall(name, args, context) {
  const automations = context.automations || [];
  const partners = context.partners || [];
  const leads = context.leads || [];
  const raw = args && typeof args === 'object' ? args : {};

  const fail = (error) => ({ ok: false, error });

  switch (name) {
    case 'propose_pause_automation': {
      const auto = pickAutomation(raw, automations);
      if (!auto) return fail('automation_not_found');
      return {
        ok: true,
        action: 'pause_automation',
        payload: { automation_id: auto.id, name: auto.name },
        summary: `להשהות את האוטומציה «${auto.name}».`,
      };
    }
    case 'propose_resume_automation': {
      const auto = pickAutomation(raw, automations);
      if (!auto) return fail('automation_not_found');
      return {
        ok: true,
        action: 'resume_automation',
        payload: { automation_id: auto.id, name: auto.name },
        summary: `להפעיל את האוטומציה «${auto.name}».`,
      };
    }
    case 'propose_update_automation': {
      const auto = pickAutomation(raw, automations);
      if (!auto) return fail('automation_not_found');
      const fields = sanitizeAutomationFields(raw.fields || raw);
      delete fields.automation_id;
      if (!Object.keys(fields).length) return fail('empty_fields');
      return {
        ok: true,
        action: 'update_automation',
        payload: { automation_id: auto.id, name: auto.name, fields },
        summary: `לעדכן את האוטומציה «${auto.name}»: ${Object.keys(fields).join(', ')}.`,
      };
    }
    case 'propose_create_automation': {
      const nameText = String(raw.name || '').trim();
      if (!nameText) return fail('name_required');
      return {
        ok: true,
        action: 'create_automation',
        payload: {
          name: nameText,
          keywords: raw.keywords || '',
          opening_dm_text: raw.opening_dm_text || '',
          opening_dm_button_label: raw.opening_dm_button_label || 'כן, אשמח ❤️',
          public_reply_variants: raw.public_reply_variants || ['איזה כיף! שלחתי לך הודעה בפרטי ❤️'],
          status: 'paused',
        },
        summary: `ליצור אוטומציה חדשה «${nameText}» (תישאר כבויה עד שתפעילי אותה).`,
      };
    }
    case 'propose_add_partner': {
      const fields = sanitizePartnerFields(raw);
      if (!fields.name) return fail('name_required');
      return {
        ok: true,
        action: 'add_partner',
        payload: fields,
        summary: `להוסיף את «${fields.name}» לרשימת שיתופי הפעולה. האפליקציה לא תשלח פנייה בשמך.`,
      };
    }
    case 'propose_update_partner': {
      let partner = raw.partner_id
        ? partners.find((p) => Number(p.id) === Number(raw.partner_id))
        : findByName(partners, raw.handle_hint || raw.name || raw.handle, ['name', 'handle']);
      if (!partner) return fail('partner_not_found');
      const fields = sanitizePartnerFields(raw.fields || raw);
      delete fields.partner_id;
      if (!Object.keys(fields).length) return fail('empty_fields');
      return {
        ok: true,
        action: 'update_partner',
        payload: { partner_id: partner.id, name: partner.name, fields },
        summary: `לעדכן את «${partner.name}».`,
      };
    }
    case 'propose_update_lead': {
      let lead = raw.lead_id
        ? leads.find((l) => Number(l.id) === Number(raw.lead_id))
        : findByName(leads, raw.username_hint || raw.username, ['username']);
      if (!lead) return fail('lead_not_found');
      const fields = {};
      if (raw.status) fields.status = raw.status;
      if (raw.fields) fields.fields = raw.fields;
      if (raw.username) fields.username = raw.username;
      if (!Object.keys(fields).length) return fail('empty_fields');
      return {
        ok: true,
        action: 'update_lead',
        payload: { lead_id: lead.id, username: lead.username, ...fields },
        summary: `לעדכן את הליד ${lead.username ? '@' + lead.username : '#' + lead.id}.`,
      };
    }
    case 'propose_feature_request': {
      const body = String(raw.body || raw.title || '').trim();
      if (!body) return fail('body_required');
      const title = String(raw.title || body).trim().slice(0, 80);
      return {
        ok: true,
        action: 'create_feature_request',
        payload: { title, body },
        summary: `לשמור בקשת שיפור: «${title}». זה לא משנה את האפליקציה מיד, רק נרשם אלינו.`,
      };
    }
    default:
      return fail('unknown_tool');
  }
}

function parseToolArgs(raw) {
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  return {};
}

function proposalsFromToolCalls(toolCalls, context) {
  const out = [];
  for (const call of toolCalls || []) {
    const name = call.function?.name || call.name;
    const args = parseToolArgs(call.function?.arguments || call.arguments);
    const result = proposalFromToolCall(name, args, context);
    out.push({ tool: name, ...result });
  }
  return out;
}

function clip(text, n = 80) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function buildContextSummary({ automations = [], partners = [], funnels = [], weekly, insights, leads = [] } = {}) {
  const autoLines = automations.map((a) =>
    `- #${a.id} «${a.name}» (${a.status === 'live' ? 'פעילה' : 'מושהית'}), מילות מפתח: ${a.keywords || a.keyword_mode || '—'}`
  );
  const funnelLines = funnels.map((f) =>
    `- «${f.name}»: תגובות ${f.comments_matched}, נשלחו ${f.sent}, טופלו ע״י רונה ${f.handled_by_owner}, הושלמו ${f.converted}`
  );
  const partnerLines = partners.slice(0, 20).map((p) =>
    `- #${p.id} ${p.name}${p.handle ? ' @' + p.handle : ''} (${p.category || ''}, ${p.status || 'idea'})`
  );
  const works = weekly?.points?.what_works || insights?.what_works;
  const recs = insights?.recommendations || [];
  return [
    'אוטומציות:',
    autoLines.join('\n') || 'אין עדיין.',
    'לידים לפי אוטומציה:',
    funnelLines.join('\n') || 'אין נתונים.',
    `לידים שמורים: ${leads.length}`,
    'שיתופי פעולה:',
    partnerLines.join('\n') || 'אין עדיין.',
    weekly?.body ? `סיכום שבועי:\n${weekly.body}` : '',
    works?.text ? `מה עובד: ${works.text}` : '',
    recs.length ? `המלצות: ${recs.map((r) => r.body).join(' ')}` : '',
  ].filter(Boolean).join('\n');
}

function systemPrompt() {
  return `את העוזרת של רונה, מיילדת שמנהלת אוטומציות אינסטגרם וקורס הכנה ללידה באפליקציה «רונה». עני תמיד בעברית, בקצרה, בחמימות ובבהירות.

מותר לך להציע פעולות רק דרך הכלים שסופקו. אסור לבצע שינוי בפועל, אסור לטעון שכבר שינית משהו, אסור לשלוח הודעות ללקוחות, אסור לשנות קוד, ואסור לעקוף את מסך האישור. אחרי קריאת כלי, הסבירי לרונה מה מוצע ושייך ללחוץ «אשרי» רק אם זה מתאים לה.

אם היא מבקשת שינוי באפליקציה עצמה (פיצ׳ר חדש, שינוי ממשק, משהו שאי אפשר לעשות עם הנתונים הקיימים) — השתמשי ב-propose_feature_request. אל תבטיחי שזה כבר פותח.

אם חסר מזהה, התאימי לפי השם מתוך ההקשר. אם לא בטוחה, שאלי שאלה במקום לנחש פעולה.`;
}

function isFeatureRequestText(text) {
  const t = String(text || '');
  return /(באפליקציה|שיפור לאפליקציה|פיצ['׳]?ר|פיצ׳ר|תוסיפו אפשרות|אפשר להוסיף לאפליקציה|בקשת שיפור|שדרוג של האפליקציה|ממשק האפליקציה)/.test(t);
}

function ruleBasedTurn(userText, context) {
  const text = String(userText || '').trim();
  const automations = context.automations || [];
  const partners = context.partners || [];
  const proposals = [];
  let reply = '';

  const namedAuto = automations.find((a) => a.name && text.includes(a.name))
    || automations.find((a) => a.keywords && String(a.keywords).split(/[,،]/).some((k) => k.trim() && text.includes(k.trim())))
    || (automations.length === 1 ? automations[0] : null);

  if (/(השהי|השהה|עצרי|כבי|pause|לכבות|להשהות)/i.test(text) && /(אוטומצ)/.test(text) || (/(השהי|עצרי|כבי)/.test(text) && namedAuto)) {
    const auto = namedAuto;
    if (!auto) {
      reply = automations.length
        ? `איזו אוטומציה להשהות? יש לי: ${automations.map((a) => '«' + a.name + '»').join(', ')}.`
        : 'עוד אין אוטומציות להשהות.';
    } else {
      const p = proposalFromToolCall('propose_pause_automation', { automation_id: auto.id }, context);
      if (p.ok) proposals.push(p);
      reply = `אפשר להשהות את «${auto.name}». אם זה מה שרצית, אשרִי ואבצע רק אחרי האישור.`;
    }
  } else if (/(הפעילי|תפעילי|חדשי|resume|להפעיל)/.test(text) && (/(אוטומצ)/.test(text) || namedAuto)) {
    const auto = namedAuto;
    if (!auto) {
      reply = `איזו אוטומציה להפעיל? ${automations.map((a) => '«' + a.name + '»').join(', ') || 'אין ברשימה.'}`;
    } else {
      const p = proposalFromToolCall('propose_resume_automation', { automation_id: auto.id }, context);
      if (p.ok) proposals.push(p);
      reply = `אפשר להפעיל את «${auto.name}». אשרִי רק אם זה מה שרצית.`;
    }
  } else if (/(שני את ההודעה|שני את המלל|שני את הטקסט|עדכני את ההודעה|ההודעה תהיה)/.test(text)) {
    const auto = namedAuto || (automations.length === 1 ? automations[0] : null);
    const m = text.match(/(?:ל|תהיה|ההודעה[:\s]+)[«"']?(.+?)[»"']?$/);
    const newText = m ? m[1].trim() : '';
    if (!auto) {
      reply = 'לאיזו אוטומציה לעדכן את הודעת הפתיחה?';
    } else if (!newText) {
      reply = `מה יהיה נוסח הודעת הפתיחה החדשה ל«${auto.name}»?`;
    } else {
      const p = proposalFromToolCall('propose_update_automation', { automation_id: auto.id, fields: { opening_dm_text: newText } }, context);
      if (p.ok) proposals.push(p);
      reply = `אעדכן את הודעת הפתיחה של «${auto.name}» רק אחרי שתאשרי.`;
    }
  } else if (/(הוסיפי שותפ|הוסיפי דולה|הוסיפי קולגה|שיתוף פעולה חדש|הוסיפי לרשימת השיתופ)/.test(text)) {
    const handle = (text.match(/@([A-Za-z0-9._]+)/) || [])[1];
    const nameMatch = text.match(/הוסיפי(?:\s+שותפה|\s+דולה|\s+קולגה)?\s+([^\n@.]+)/);
    const name = (nameMatch ? nameMatch[1] : '').replace(/לרשימה.*/, '').trim();
    if (!name && !handle) {
      reply = 'אשמחה להוסיף שותפה. מה השם, ואם יש — ההאנדל באינסטגרם? האפליקציה לא תשלח פנייה בשמך.';
    } else {
      const p = proposalFromToolCall('propose_add_partner', { name: name || handle, handle, category: /דולה/.test(text) ? 'doula' : '' }, context);
      if (p.ok) proposals.push(p);
      reply = 'אפשר להוסיף אותה לרשימת שיתופי הפעולה. אשרִי כדי לשמור — בלי לשלוח הודעה.';
    }
  } else if (isFeatureRequestText(text) || /אני רוצה שתהיה אפשרות|תוסיפו כפתור|שיש אפשרות באפליקציה/.test(text)) {
    const p = proposalFromToolCall('propose_feature_request', { title: clip(text, 60), body: text }, context);
    if (p.ok) proposals.push(p);
    reply = 'זו בקשה לשינוי באפליקציה עצמה, לא פעולה על החשבון. אם תאשרי, אשמור אותה כבקשת שיפור — בלי לשנות קוד.';
  } else if (/(מה עובד|סיכום שבועי|המלצ|נתונים|חשיפה|עוקב)/.test(text)) {
    const works = context.weekly?.points?.what_works || context.insights?.what_works;
    const weekly = context.weekly;
    const bits = [];
    if (weekly?.points?.improved) bits.push(`מה השתפר: ${weekly.points.improved}`);
    if (weekly?.points?.dropped) bits.push(`מה ירד: ${weekly.points.dropped}`);
    if (works?.text) bits.push(`מה עובד: ${works.text}`);
    if (weekly?.points?.recommendation) bits.push(`המלצה: ${weekly.points.recommendation}`);
    if (context.insights?.recommendations?.[0]) bits.push(context.insights.recommendations[0].body);
    reply = bits.length
      ? bits.join('\n\n')
      : 'עוד אין מספיק נתונים לסיכום. אחרי שיתחברו התובנות, אוסיף כאן מגמות והמלצות.';
  } else if (/(ליד|משפך|כמה נשלח)/.test(text)) {
    const funnels = context.funnels || [];
    reply = funnels.length
      ? funnels.map((f) => `«${f.name}»: ${f.comments_matched} תגובות, ${f.sent} נשלחו, ${f.handled_by_owner} טופלו על ידייך, ${f.converted} הושלמו.`).join('\n')
      : 'עדיין אין לידים שמורים לאוטומציות.';
  } else {
    reply = automations.length
      ? 'אני כאן. אפשר לשאול על הנתונים, על הלידים, או לבקש ממני להציע פעולה — למשל להשהות אוטומציה, לעדכן הודעת פתיחה, או להוסיף שותפה. שום שינוי לא יתבצע בלי אישור שלך.'
      : 'אני כאן לשאלות על החשבון ולבקשות פשוטות. שינוי באפליקציה עצמה יישמר כבקשת שיפור, ורק אחרי אישור.';
  }

  return { reply, proposals, source: 'rules' };
}

module.exports = {
  ALLOWED_ACTIONS,
  AUTOMATION_PATCH_FIELDS,
  ACTION_LABELS,
  isAllowedAction,
  toolDefinitions,
  proposalFromToolCall,
  proposalsFromToolCalls,
  sanitizeAutomationFields,
  sanitizePartnerFields,
  buildContextSummary,
  systemPrompt,
  ruleBasedTurn,
  isFeatureRequestText,
  findByName,
  LEAD_FIELDS,
};
