const $app = document.getElementById('app');
const state = {
  me: null,
  tab: 'autos',
  automations: [],
  media: [],
  logs: [],
  editor: null,
  recipientsFor: null,
  recipients: [],
  toast: '',
  loading: false,
  installPrompt: null,
};

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  state.installPrompt = e;
  render();
});

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'checked') el.checked = !!v;
    else if (k === 'value') el.value = v ?? '';
    else if (v === false || v === null || v === undefined) continue;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    credentials: 'same-origin',
    ...opts,
    body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function atUser(name) {
  return h('span', { class: 'handle', dir: 'ltr' }, '@' + name);
}

function toast(msg) {
  state.toast = msg;
  render();
  setTimeout(() => {
    if (state.toast === msg) {
      state.toast = '';
      render();
    }
  }, 2400);
}

function icon(name) {
  const paths = {
    home: '<path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z" fill="currentColor"/>',
    flask: '<path d="M9 3h6v2h-1v5.2l5.6 8.4A1.5 1.5 0 0 1 18.4 21H5.6a1.5 1.5 0 0 1-1.2-2.4L10 10.2V5H9V3z" fill="currentColor"/>',
    user: '<path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm0 2c-4 0-8 2-8 5v1h16v-1c0-3-4-5-8-5z" fill="currentColor"/>',
  };
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.innerHTML = paths[name] || '';
  return svg;
}

function triggerLabel(a) {
  if (a.trigger_scope === 'any') return 'כל פוסט או ריל';
  if (a.trigger_scope === 'next') return a.next_pending ? 'הפוסט הבא שיעלה' : 'הפוסט הבא (כבר שויך)';
  return a.media_caption ? `פוסט: ${a.media_caption}` : 'פוסט מסוים';
}

function keywordLabel(a) {
  if (a.keyword_mode === 'any') return 'כל תגובה';
  const type = a.match_type === 'contains' ? 'מכיל' : 'מילה שלמה';
  return `${type}: ${a.keywords || '—'}`;
}

function statusLabel(s) {
  const map = {
    opening_sent: 'נשלחה הודעת פתיחה',
    button_pressed: 'לחצה על הכפתור',
    second_sent: 'נשלחה הודעה שנייה',
    followup_sent: 'נשלחה תזכורת',
    clicked: 'לחצה על הלינק',
    clicked_after_followup: 'לחצה אחרי תזכורת',
    skipped_not_follower: 'דולגה — לא עוקבת',
    skipped_private_reply_used: 'כבר נשלחה תשובה פרטית',
    comment_only: 'תגובה ציבורית בלבד',
    window_expired: 'חלון 24 שעות פג',
  };
  return map[s] || s;
}

function blankAutomation() {
  return {
    name: '',
    status: 'paused',
    trigger_scope: 'specific',
    media_id: '',
    media_permalink: '',
    media_thumbnail: '',
    media_caption: '',
    media_type: '',
    keyword_mode: 'keywords',
    keywords: '',
    match_type: 'whole_word',
    public_reply_enabled: true,
    public_reply_variants: ['איזה כיף! שלחתי לך הודעה בפרטי ❤️'],
    opening_dm_enabled: true,
    opening_dm_text: 'היי! שמחה שאהבת 😊 רוצה שאשלח לך את הפרטים?',
    opening_dm_button_label: 'כן, אשמח ❤️',
    must_follow: false,
    collect_email: false,
    second_dm_text: 'הנה הפרטים מחכים לך כאן 👇',
    second_dm_link_url: '',
    second_dm_link_title: 'לצפייה',
    followup_enabled: false,
    followup_hours: 24,
    followup_text: 'היי, רק רציתי לוודא שקיבלת את הלינק 💕',
  };
}

async function loadMe() {
  try {
    const data = await api('/auth/me');
    state.me = data;
    return true;
  } catch {
    state.me = null;
    return false;
  }
}

async function loadAutos() {
  const data = await api('/api/automations');
  state.automations = data.automations || [];
}

async function loadMedia() {
  const data = await api('/api/media');
  state.media = data.media || [];
}

async function loadLogs() {
  const data = await api('/api/logs');
  state.logs = data.logs || [];
}

function render() {
  $app.replaceChildren();
  if (state.toast) $app.append(h('div', { class: 'toast' }, state.toast));
  if (!state.me) {
    $app.append(renderLogin());
    return;
  }
  if (state.editor) {
    $app.append(renderEditor());
    return;
  }
  if (state.recipientsFor) {
    $app.append(renderRecipients());
    return;
  }
  $app.append(renderShell());
}

function renderLogin() {
  const params = new URLSearchParams(location.search);
  const err = params.get('auth_error');
  const mock = !err && (document.documentElement.dataset.mock !== 'false');
  const loginBtn = h('a', { class: 'btn btn-ig', href: '/auth/login', id: 'login-btn' }, 'התחברות עם פייסבוק');
  const box = h('div', { class: 'login' },
    h('div', { class: 'logo-mark' }, 'ר'),
    h('h1', {}, 'רונה'),
    h('p', { class: 'lead' }, 'אוטומציות לאינסטגרם: מישהי מגיבה מילה שבחרת — והיא מקבלת תגובה בפוסט והודעה בפרטי.'),
    err ? h('div', { class: 'error-banner' }, err) : null,
    loginBtn,
    h('p', { class: 'hint', id: 'mock-hint' }, ''),
  );
  api('/api/health').then((hth) => {
    const hint = box.querySelector('#mock-hint');
    if (hth.authMode === 'instagram') {
      loginBtn.textContent = 'התחברות עם אינסטגרם';
    } else {
      loginBtn.textContent = 'התחברות עם פייסבוק';
    }
    if (hth.mockMode) {
      const btn = h('button', {
        class: 'btn btn-ghost',
        style: { marginTop: '12px', width: 'min(100%, 320px)' },
        onClick: async () => {
          await api('/auth/mock-login', { method: 'POST', body: { username: 'rona_demo' } });
          await boot();
        },
      }, 'כניסה במצב הדגמה');
      hint.before(btn);
      hint.textContent = 'מצב הדגמה פעיל — בלי חיבור אמיתי לאינסטגרם. מתאים לבדיקות לפני שמזינים פרטי Meta.';
    } else if (hth.authMode === 'instagram') {
      hint.textContent = 'יש להתחבר עם חשבון אינסטגרם מקצועי (Creator או Business).';
    } else {
      hint.textContent = 'Facebook Login for Business: בחלון של Meta אפשר לבחור פייסבוק או אינסטגרם, ואז את תיק העסק והעמוד שמקושר לחשבון של רונה.';
    }
  }).catch(() => {});
  return box;
}

function renderShell() {
  const acc = state.me.account || {};
  const shell = h('div', { class: 'shell' },
    h('header', { class: 'topbar' },
      h('div', { class: 'brand' },
        h('div', { class: 'brand-mark' }, 'ר'),
        h('span', {}, 'רונה'),
        state.me.mockMode ? h('span', { class: 'badge-mock' }, 'הדגמה') : null,
      ),
      h('div', { class: 'account-chip' },
        h('div', { class: 'avatar' }, acc.profile_picture_url
          ? h('img', { src: acc.profile_picture_url, alt: '' })
          : (acc.username || 'ר').slice(0, 1)),
        acc.username ? atUser(acc.username) : h('span', {}, 'חשבון'),
      ),
    ),
    h('main', { class: 'page' },
      state.tab === 'autos' ? renderAutosPage() :
      state.tab === 'sim' ? renderSimPage() :
      renderAccountPage()
    ),
    h('nav', { class: 'bottom-nav' },
      navBtn('autos', 'home', 'אוטומציות'),
      state.me.mockMode ? navBtn('sim', 'flask', 'סימולציה') : null,
      navBtn('account', 'user', 'חשבון'),
    ),
  );
  if (state.tab === 'autos') {
    shell.append(h('button', {
      class: 'fab',
      title: 'אוטומציה חדשה',
      onClick: async () => {
        try { await loadMedia(); } catch { state.media = []; }
        state.editor = blankAutomation();
        render();
      },
    }, '+'));
  }
  return shell;
}

function navBtn(id, ic, label) {
  return h('button', {
    class: 'nav-btn' + (state.tab === id ? ' active' : ''),
    onClick: async () => {
      state.tab = id;
      if (id === 'sim') await loadLogs().catch(() => {});
      render();
    },
  }, icon(ic), label);
}

function renderAutosPage() {
  const list = state.automations;
  const wrap = h('div', {});
  wrap.append(
    h('div', { class: 'page-head' },
      h('h2', {}, 'אוטומציות'),
    )
  );
  if (!list.length) {
    wrap.append(h('div', { class: 'empty card' },
      h('h3', {}, 'עוד אין אוטומציות'),
      h('p', {}, 'צרו אוטומציה ראשונה: בחרו פוסט, מילת מפתח, והודעה שתישלח בפרטי.'),
    ));
    return wrap;
  }
  for (const a of list) wrap.append(automationCard(a));
  return wrap;
}

function automationCard(a) {
  const metrics = a.metrics || {};
  return h('article', { class: 'card auto-card' },
    h('div', { class: 'auto-top' },
      a.media_thumbnail ? h('img', { class: 'thumb', src: a.media_thumbnail, alt: '' }) : null,
      h('div', { style: { flex: '1', minWidth: 0 } },
        h('h3', { class: 'auto-title' }, a.name),
        h('div', { class: 'auto-meta' }, triggerLabel(a)),
        h('div', { class: 'auto-meta' }, keywordLabel(a)),
      ),
      h('span', { class: 'status-pill ' + (a.status === 'live' ? 'status-live' : 'status-paused') },
        a.status === 'live' ? 'פעילה' : 'מושהית'),
    ),
    h('div', { class: 'metrics' },
      h('span', {}, 'נשלחו ', h('b', {}, String(metrics.total_sends || 0))),
      h('span', {}, 'הקליקו ', h('b', {}, String(metrics.total_clicks || 0))),
    ),
    h('div', { class: 'row-actions' },
      h('label', { class: 'switch', title: 'הפעלה' },
        h('input', {
          type: 'checkbox',
          checked: a.status === 'live',
          onChange: async (e) => {
            try {
              await api(`/api/automations/${a.id}/status`, {
                method: 'POST',
                body: { status: e.target.checked ? 'live' : 'paused' },
              });
              await loadAutos();
              toast(e.target.checked ? 'האוטומציה פעילה' : 'האוטומציה הושהתה');
              render();
            } catch (err) { toast('שגיאה: ' + err.message); }
          },
        }),
        h('span', {}),
      ),
      h('button', { class: 'btn btn-ghost btn-sm', onClick: async () => {
        try { await loadMedia(); } catch { state.media = []; }
        state.editor = { ...blankAutomation(), ...a };
        render();
      } }, 'עריכה'),
      h('button', { class: 'btn btn-ghost btn-sm', onClick: async () => {
        const data = await api(`/api/automations/${a.id}/recipients`);
        state.recipientsFor = a;
        state.recipients = data.recipients || [];
        render();
      } }, 'נמענות'),
    )
  );
}

function field(label, el) {
  const l = h('label', { class: 'field' }, h('span', {}, label));
  l.append(el);
  return l;
}

function renderEditor() {
  const a = state.editor;
  const variantsText = Array.isArray(a.public_reply_variants)
    ? a.public_reply_variants.join('\n')
    : String(a.public_reply_variants || '');

  function set(k, v) { a[k] = v; }

  const body = h('div', { class: 'panel-body' },
    h('div', { class: 'section' },
      field('שם האוטומציה', h('input', { type: 'text', value: a.name, placeholder: 'למשל: מתכון — הכנה', onInput: (e) => set('name', e.target.value) })),
    ),
    h('div', { class: 'section' },
      h('h3', {}, 'על איזה פוסט זה יעבוד?'),
      choice('specific', 'פוסט או ריל מסוים', 'בוחרים מהרשימה של החשבון', a.trigger_scope === 'specific', () => { a.trigger_scope = 'specific'; render(); }),
      choice('any', 'כל פוסט או ריל', 'גם על תכנים קיימים וגם על מה שיעלה בהמשך', a.trigger_scope === 'any', () => { a.trigger_scope = 'any'; a.media_id = ''; render(); }),
      choice('next', 'הפוסט או הריל הבא שיעלה', 'תשויך אוטומטית לפרסום הבא בחשבון', a.trigger_scope === 'next', () => { a.trigger_scope = 'next'; render(); }),
      a.trigger_scope === 'specific' ? mediaPicker(a) : null,
    ),
    h('div', { class: 'section' },
      h('h3', {}, 'מתי להפעיל?'),
      h('div', { class: 'kw-mode' },
        h('button', { class: 'choice' + (a.keyword_mode === 'keywords' ? ' active' : ''), type: 'button', onClick: () => { a.keyword_mode = 'keywords'; render(); } }, 'מילות מפתח'),
        h('button', { class: 'choice' + (a.keyword_mode === 'any' ? ' active' : ''), type: 'button', onClick: () => { a.keyword_mode = 'any'; render(); } }, 'כל מילה / כל תגובה'),
      ),
      a.keyword_mode === 'keywords' ? [
        field('מילים (מופרדות בפסיק, בעברית או באנגלית)', h('input', { type: 'text', value: a.keywords, placeholder: 'הכנה, מתכון, אני רוצה', onInput: (e) => set('keywords', e.target.value) })),
        field('סוג התאמה', (() => {
          const s = h('select', { onChange: (e) => set('match_type', e.target.value) },
            h('option', { value: 'whole_word' }, 'מילה שלמה'),
            h('option', { value: 'contains' }, 'מכיל (גם בתוך מילה)'),
          );
          s.value = a.match_type || 'whole_word';
          return s;
        })()),
      ] : h('p', { class: 'help' }, 'כל תגובה על הפוסט הנבחר תפעיל את האוטומציה.'),
    ),
    h('div', { class: 'section card' },
      toggleRow('תגובה ציבורית בפוסט', 'נבחרת באקראי מבין כמה גרסאות', a.public_reply_enabled, (v) => { a.public_reply_enabled = v; render(); }),
      a.public_reply_enabled ? field('גרסאות (שורה לכל גרסה)', h('textarea', {
        value: variantsText,
        onInput: (e) => { a.public_reply_variants = e.target.value.split('\n'); },
      })) : null,
    ),
    h('div', { class: 'section card' },
      toggleRow('הודעת פתיחה ב-DM', 'נשלחת כתשובה פרטית לתגובה (אחת לכל תגובה, עד 7 ימים)', a.opening_dm_enabled, (v) => { a.opening_dm_enabled = v; render(); }),
      a.opening_dm_enabled ? [
        field('טקסט ההודעה', h('textarea', { value: a.opening_dm_text, onInput: (e) => set('opening_dm_text', e.target.value) })),
        field('תווית כפתור (מענה מהיר)', h('input', { type: 'text', value: a.opening_dm_button_label, maxlength: '20', onInput: (e) => set('opening_dm_button_label', e.target.value) })),
      ] : null,
    ),
    h('div', { class: 'section card' },
      h('h3', {}, 'הודעה שנייה — אחרי הלחיצה על הכפתור'),
      h('p', { class: 'help' }, 'נשלחת רק אחרי שהעוקבת לוחצת על הכפתור, בתוך חלון של 24 שעות.'),
      field('טקסט', h('textarea', { value: a.second_dm_text, onInput: (e) => set('second_dm_text', e.target.value) })),
      field('קישור (רשות)', h('input', { type: 'url', value: a.second_dm_link_url, placeholder: 'https://…', onInput: (e) => set('second_dm_link_url', e.target.value) })),
      field('תווית כפתור הקישור', h('input', { type: 'text', value: a.second_dm_link_title, maxlength: '20', onInput: (e) => set('second_dm_link_title', e.target.value) })),
    ),
    h('div', { class: 'section card' },
      h('h3', {}, 'אפשרויות נוספות'),
      toggleRow('חייבת לעקוב קודם', 'אם היא לא עוקבת — תישלח תגובה שמבקשת לעקוב, בלי DM', a.must_follow, (v) => { a.must_follow = v; render(); }),
      toggleRow('איסוף אימייל (ניסיון)', 'אינסטגרם לא תומכת בכפתור אימייל רשמי; נבקש בטקסט ונזהה כתובת בתשובה', a.collect_email, (v) => { a.collect_email = v; render(); }),
      toggleRow('תזכורת אם לא לחצה על הלינק', 'נשלחת רק אם היא לחצה על הכפתור ועדיין בתוך 24 שעות', a.followup_enabled, (v) => { a.followup_enabled = v; render(); }),
      a.followup_enabled ? [
        field('אחרי כמה שעות', h('input', { type: 'number', min: '1', step: '1', value: a.followup_hours, onInput: (e) => set('followup_hours', Number(e.target.value || 24)) })),
        field('טקסט התזכורת', h('textarea', { value: a.followup_text, onInput: (e) => set('followup_text', e.target.value) })),
      ] : null,
    ),
  );

  const panel = h('div', { class: 'panel' },
    h('div', { class: 'panel-bar' },
      h('button', { class: 'icon-btn', onClick: () => { state.editor = null; render(); } }, '→'),
      h('h2', {}, a.id ? 'עריכת אוטומציה' : 'אוטומציה חדשה'),
      a.id ? h('button', { class: 'icon-btn', title: 'מחיקה', onClick: () => removeAuto(a) }, '🗑') : h('span', { style: { width: '40px' } }),
    ),
    body,
    h('div', { class: 'panel-foot' },
      h('button', { class: 'btn btn-ghost', onClick: () => { state.editor = null; render(); } }, 'ביטול'),
      h('button', { class: 'btn btn-ig', onClick: () => saveAuto(a) }, 'שמירה'),
    ),
  );
  return panel;
}

function choice(id, title, sub, active, onClick) {
  return h('button', { type: 'button', class: 'choice' + (active ? ' active' : ''), style: { width: '100%', marginBottom: '8px' }, onClick },
    title,
    h('small', {}, sub),
  );
}

function toggleRow(title, sub, on, onChange) {
  return h('div', { class: 'toggle-row' },
    h('div', {}, h('div', { class: 'lbl' }, title), h('div', { class: 'sub' }, sub)),
    h('label', { class: 'switch' },
      h('input', { type: 'checkbox', checked: !!on, onChange: (e) => onChange(e.target.checked) }),
      h('span', {}),
    ),
  );
}

function mediaPicker(a) {
  if (!state.media.length) {
    return h('p', { class: 'help' }, 'לא נמצאו פוסטים (במצב הדגמה מופיעים פוסטים לדוגמה אחרי רענון).');
  }
  const grid = h('div', { class: 'media-grid' });
  for (const m of state.media) {
    const thumb = m.thumbnail_url || m.media_url || '';
    grid.append(h('button', {
      type: 'button',
      class: 'media-tile' + (a.media_id === m.id ? ' active' : ''),
      onClick: () => {
        a.media_id = m.id;
        a.media_permalink = m.permalink || '';
        a.media_thumbnail = thumb;
        a.media_caption = m.caption || '';
        a.media_type = m.media_type || m.media_product_type || '';
        render();
      },
    },
      thumb ? h('img', { src: thumb, alt: '' }) : null,
      h('div', { class: 'cap' }, (m.media_product_type === 'REELS' || m.media_type === 'VIDEO' ? 'ריל · ' : '') + (m.caption || m.id)),
    ));
  }
  return grid;
}

async function saveAuto(a) {
  if (!a.name?.trim()) return toast('צריך שם לאוטומציה');
  if (a.trigger_scope === 'specific' && !a.media_id) return toast('בחרו פוסט או ריל');
  const payload = {
    ...a,
    public_reply_variants: Array.isArray(a.public_reply_variants)
      ? a.public_reply_variants.map((s) => String(s).trim()).filter(Boolean)
      : a.public_reply_variants,
  };
  try {
    if (a.id) await api(`/api/automations/${a.id}`, { method: 'PUT', body: payload });
    else await api('/api/automations', { method: 'POST', body: payload });
    state.editor = null;
    await loadAutos();
    toast('נשמר בהצלחה');
    render();
  } catch (err) {
    toast('שגיאה בשמירה: ' + err.message);
  }
}

async function removeAuto(a) {
  if (!confirm('למחוק את האוטומציה?')) return;
  await api(`/api/automations/${a.id}`, { method: 'DELETE' });
  state.editor = null;
  await loadAutos();
  toast('נמחקה');
  render();
}

function renderRecipients() {
  const a = state.recipientsFor;
  return h('div', { class: 'panel' },
    h('div', { class: 'panel-bar' },
      h('button', { class: 'icon-btn', onClick: () => { state.recipientsFor = null; render(); } }, '→'),
      h('h2', {}, 'נמענות · ' + a.name),
      h('span', { style: { width: '40px' } }),
    ),
    h('div', { class: 'panel-body' },
      state.recipients.length ? state.recipients.map((r) =>
        h('div', { class: 'recipient' },
          h('div', {},
            r.username ? h('b', {}, atUser(r.username)) : h('b', {}, r.igsid || '—'),
            h('div', { class: 'muted' }, r.comment_text || ''),
            h('div', { class: 'muted' }, statusLabel(r.status)),
          ),
          h('div', { class: 'muted' }, (r.clicked_at ? '✓ קליק' : '')),
        )
      ) : h('div', { class: 'empty' }, h('p', {}, 'עדיין אין נמענות לאוטומציה הזו.')),
    ),
  );
}

function renderSimPage() {
  const wrap = h('div', {});
  wrap.append(h('div', { class: 'page-head' }, h('h2', {}, 'סימולציה')));
  wrap.append(h('p', { class: 'help', style: { marginTop: 0 } }, 'שולחים תגובה מזויפת כמו וובהוק של אינסטגרם, ורואים מה האפליקציה הייתה שולחת — בלי לגעת בחשבון האמיתי.'));

  const autos = state.automations.filter((a) => a.status === 'live');
  const mediaOptions = state.media.length ? state.media : [
    { id: 'mock_media_reel_cake', caption: 'הכנה של העוגה' },
  ];

  const textIn = h('input', { type: 'text', value: 'הכנה', id: 'sim-text' });
  const userIn = h('input', { type: 'text', value: 'follower_demo', id: 'sim-user' });
  const followIn = h('input', { type: 'checkbox', checked: true });
  const mediaSel = h('select', {});
  for (const m of mediaOptions) mediaSel.append(h('option', { value: m.id }, m.caption || m.id));

  wrap.append(h('div', { class: 'card' },
    field('טקסט התגובה', textIn),
    field('שם המגיבה', userIn),
    field('פוסט', mediaSel),
    h('div', { class: 'toggle-row' },
      h('div', { class: 'lbl' }, 'האם עוקבת?'),
      h('label', { class: 'switch' }, followIn, h('span', {})),
    ),
    h('button', {
      class: 'btn btn-ig', style: { width: '100%', marginTop: '8px' },
      onClick: async () => {
        try {
          const data = await api('/api/mock/comment', {
            method: 'POST',
            body: {
              text: textIn.value,
              username: userIn.value,
              media_id: mediaSel.value,
              is_follower: followIn.checked,
            },
          });
          state.logs = data.logs || [];
          await loadAutos();
          const r = (data.results && data.results[0]) || {};
          if (r.ok) toast('נשלחו תגובה והודעה בפרטי (הדגמה)');
          else toast('לא הופעל: ' + (r.reason || 'לא ידוע'));
          // stash last result for postback
          state._lastSim = r;
          render();
          state.tab = 'sim';
        } catch (err) { toast(err.message); }
      },
    }, 'שלחי תגובה מדומה'),
    h('button', {
      class: 'btn btn-ghost', style: { width: '100%', marginTop: '8px' },
      onClick: async () => {
        const r = state._lastSim;
        if (!r?.recipientId || !r.automationId) return toast('קודם שלחו תגובה שהפעילה אוטומציה');
        const auto = state.automations.find((x) => x.id === r.automationId);
        const recs = await api(`/api/automations/${r.automationId}/recipients`);
        const rec = (recs.recipients || []).find((x) => x.id === r.recipientId);
        if (!rec) return toast('לא נמצאה נמענת');
        const data = await api('/api/mock/postback', {
          method: 'POST',
          body: {
            sender_id: rec.igsid,
            payload: `QR_YES:${r.automationId}:${r.recipientId}`,
            title: auto?.opening_dm_button_label || 'כן, אשמח ❤️',
          },
        });
        state.logs = data.logs || [];
        await loadAutos();
        toast('הודעה שנייה נשלחה (הדגמה)');
        render();
        state.tab = 'sim';
      },
    }, 'לחצי על כפתור ה-DM'),
  ));

  wrap.append(h('h3', {}, 'מה היה נשלח'));
  if (!state.logs.length) wrap.append(h('p', { class: 'muted' }, 'אין עדיין לוג.'));
  for (const log of state.logs) {
    let payload = log.payload;
    try { payload = JSON.stringify(JSON.parse(log.payload), null, 2); } catch {}
    wrap.append(h('div', { class: 'log-item' },
      h('b', {}, log.type + (log.mock ? ' · הדגמה' : '')),
      h('pre', {}, payload),
    ));
  }
  return wrap;
}

function renderAccountPage() {
  const acc = state.me.account || {};
  const accounts = state.me.accounts || [];
  const wrap = h('div', {});
  wrap.append(h('div', { class: 'page-head' }, h('h2', {}, 'חשבון')));

  if (state.installPrompt) {
    wrap.append(h('div', { class: 'install-banner' },
      h('div', {}, h('b', {}, 'הוספה למסך הבית'), h('div', { class: 'muted' }, 'כדי לפתוח כמו אפליקציה בטלפון')),
      h('button', { class: 'btn btn-sm btn-ig', onClick: async () => {
        state.installPrompt.prompt();
        await state.installPrompt.userChoice;
        state.installPrompt = null;
        render();
      } }, 'התקנה'),
    ));
  } else {
    wrap.append(h('div', { class: 'card' },
      h('b', {}, 'בטלפון של רונה'),
      h('p', { class: 'help' }, 'בספארי באייפון: שתפו → «הוספה למסך הבית». בכרום באנדרואיד: התפריט → «הוסף למסך הבית».'),
    ));
  }

  wrap.append(h('div', { class: 'card' },
    h('h3', {}, 'חשבון מחובר'),
    h('p', {}, acc.username ? atUser(acc.username) : 'אין חשבון פעיל'),
    h('p', { class: 'muted' }, acc.account_type || ''),
    accounts.length > 1 ? accounts.map((a) =>
      h('button', {
        class: 'choice' + (acc.id === a.id ? ' active' : ''),
        style: { width: '100%', marginBottom: '8px' },
        onClick: async () => {
          await api(`/api/accounts/${a.id}/select`, { method: 'POST' });
          await boot();
        },
      }, atUser(a.username))
    ) : null,
    h('a', { class: 'btn btn-ghost', href: '/auth/login?add=1', style: { width: '100%', marginTop: '8px' } }, 'הוספת חשבון אינסטגרם נוסף'),
  ));

  wrap.append(h('div', { class: 'card' },
    h('p', { class: 'help' }, state.me.mockMode
      ? 'כרגע האפליקציה במצב הדגמה. כדי להתחבר לחשבון האמיתי של רונה יש להגדיר פרטי Meta ולכבות את MOCK_MODE — ההסבר המלא ב־README.'
      : (state.me.authMode === 'instagram'
        ? 'החיבור הוא דרך Instagram Login (graph.instagram.com). האסימון מתחדש אוטומטית.'
        : 'החיבור הוא דרך Facebook Login for Business. אסימון העמוד (Page) שנוצר מאסימון משתמש ארוך-טווח לא פג תוקף.')),
    h('button', { class: 'btn btn-danger', style: { width: '100%' }, onClick: async () => {
      await api('/auth/logout', { method: 'POST' });
      state.me = null;
      state.automations = [];
      render();
    } }, 'התנתקות'),
  ));
  return wrap;
}

async function renderPendingPicker(pending) {
  const box = h('div', { class: 'login' },
    h('div', { class: 'logo-mark' }, 'ר'),
    h('h1', {}, 'בחירת חשבון'),
    h('p', { class: 'lead' }, 'נמצאו כמה חשבונות אינסטגרם. בחרו איזה חשבון לנהל עכשיו.'),
  );
  for (const a of pending.accounts || []) {
    box.append(h('button', {
      class: 'choice',
      style: { width: 'min(100%, 320px)', marginBottom: '8px' },
      onClick: async () => {
        await api('/auth/pending/select', { method: 'POST', body: { ig_user_id: a.igUserId } });
        await boot();
      },
    }, a.username ? '@' + a.username : a.name, a.pageName ? h('small', {}, 'עמוד: ' + a.pageName) : null));
  }
  $app.replaceChildren(box);
}

async function boot() {
  const params = new URLSearchParams(location.search);
  if (params.get('pick_account') === '1') {
    try {
      const data = await api('/auth/pending');
      if (data.pending?.accounts?.length) {
        await renderPendingPicker(data.pending);
        return;
      }
    } catch {}
  }
  const ok = await loadMe();
  if (ok) {
    await loadAutos().catch(() => {});
    await loadMedia().catch(() => {});
  }
  render();
}

boot();
