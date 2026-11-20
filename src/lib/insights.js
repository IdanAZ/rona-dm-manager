const { WEEKDAYS_HE, jerusalemParts, parseMediaDate, weekStartSundayJerusalem } = require('./time');

const CONTENT_TYPE_LABELS = {
  REELS: 'רילס',
  VIDEO: 'וידאו',
  IMAGE: 'תמונה',
  CAROUSEL_ALBUM: 'קרוסלה',
  FEED: 'פוסט',
};

function contentType(media) {
  if (!media) return 'IMAGE';
  if (media.media_product_type === 'REELS' || media.media_type === 'REELS') return 'REELS';
  if (media.media_type === 'CAROUSEL_ALBUM') return 'CAROUSEL_ALBUM';
  if (media.media_type === 'VIDEO') return 'VIDEO';
  return 'IMAGE';
}

function contentTypeLabel(type) {
  return CONTENT_TYPE_LABELS[type] || type;
}

function engagementOf(media) {
  if (!media) return 0;
  if (media.total_interactions != null && media.total_interactions !== '') {
    return Number(media.total_interactions) || 0;
  }
  return (
    Number(media.like_count || media.likes || 0) +
    Number(media.comments_count || media.comments || 0) +
    Number(media.saved || 0) +
    Number(media.shares || 0)
  );
}

function periodWindow(days, now = new Date()) {
  const n = Number(days) || 7;
  const until = new Date(now);
  const since = new Date(now.getTime() - n * 86400000);
  const prevUntil = new Date(since);
  const prevSince = new Date(since.getTime() - n * 86400000);
  return { since, until, prevSince, prevUntil, days: n };
}

function inRange(date, since, until) {
  if (!date) return false;
  const t = date.getTime();
  return t >= since.getTime() && t < until.getTime();
}

function pctChange(curr, prev) {
  const c = Number(curr) || 0;
  const p = Number(prev);
  if (p === 0 || Number.isNaN(p)) return c ? 100 : 0;
  return Math.round(((c - p) / Math.abs(p)) * 1000) / 10;
}

function sumInsightValues(series) {
  if (series == null) return 0;
  if (typeof series === 'number') return series;
  if (typeof series.total === 'number') return series.total;
  if (Array.isArray(series.values)) {
    return series.values.reduce((s, v) => s + Number(v.value || 0), 0);
  }
  return 0;
}

function parseGraphInsights(payload) {
  const out = {};
  const data = Array.isArray(payload) ? payload : (payload?.data || []);
  if (!Array.isArray(data)) return out;
  for (const metric of data) {
    if (!metric || !metric.name) continue;
    const values = (metric.values || []).map((v) => ({
      value: Number(v.value || 0),
      end_time: v.end_time,
    }));
    const total = metric.total_value && metric.total_value.value != null
      ? Number(metric.total_value.value)
      : values.reduce((s, v) => s + v.value, 0);
    out[metric.name] = { name: metric.name, values, total, period: metric.period || null };
  }
  return out;
}

function computeMediaTrends(mediaList, days, now = new Date()) {
  const window = periodWindow(days, now);
  const dated = (mediaList || []).map((m) => ({ ...m, _date: parseMediaDate(m.timestamp) }));
  const cur = dated.filter((m) => inRange(m._date, window.since, window.until));
  const prev = dated.filter((m) => inRange(m._date, window.prevSince, window.prevUntil));
  const agg = (arr) => {
    const likes = arr.reduce((s, m) => s + Number(m.like_count || 0), 0);
    const comments = arr.reduce((s, m) => s + Number(m.comments_count || 0), 0);
    const engagement = arr.reduce((s, m) => s + engagementOf(m), 0);
    return {
      posts: arr.length,
      likes,
      comments,
      engagement,
      engagement_per_post: arr.length ? Math.round((engagement / arr.length) * 10) / 10 : 0,
    };
  };
  const current = agg(cur);
  const previous = agg(prev);
  return {
    source: 'media_fields',
    insights_available: false,
    period_days: window.days,
    since: window.since.toISOString(),
    until: window.until.toISOString(),
    current,
    previous,
    deltas: {
      posts: pctChange(current.posts, previous.posts),
      likes: pctChange(current.likes, previous.likes),
      comments: pctChange(current.comments, previous.comments),
      engagement: pctChange(current.engagement, previous.engagement),
    },
  };
}

function mergeAccountInsights(trends, currentInsights, previousInsights, followerNow, followerPrev) {
  const cur = parseGraphInsights(currentInsights);
  const prev = parseGraphInsights(previousInsights);
  const reach = sumInsightValues(cur.reach);
  const prevReach = sumInsightValues(prev.reach);
  const views = sumInsightValues(cur.views || cur.impressions);
  const prevViews = sumInsightValues(prev.views || prev.impressions);
  const engaged = sumInsightValues(cur.accounts_engaged || cur.total_interactions);
  const prevEngaged = sumInsightValues(prev.accounts_engaged || prev.total_interactions);
  const hasInsights = Object.keys(cur).length > 0;

  const followers = followerNow != null && followerNow !== '' ? Number(followerNow) : null;
  const followersPrevious = followerPrev != null && followerPrev !== '' ? Number(followerPrev) : null;
  const followerGrowth = (followers != null && followersPrevious != null)
    ? followers - followersPrevious
    : null;

  const engagementRate = reach > 0 ? Math.round((engaged / reach) * 10000) / 100 : null;
  const prevRate = prevReach > 0 ? Math.round((prevEngaged / prevReach) * 10000) / 100 : null;

  return {
    ...trends,
    source: hasInsights ? 'instagram_insights' : trends.source,
    insights_available: hasInsights,
    reach: { current: reach, previous: prevReach, delta: pctChange(reach, prevReach) },
    views: { current: views, previous: prevViews, delta: pctChange(views, prevViews) },
    accounts_engaged: { current: engaged, previous: prevEngaged, delta: pctChange(engaged, prevEngaged) },
    followers: {
      current: Number.isFinite(followers) ? followers : null,
      previous: Number.isFinite(followersPrevious) ? followersPrevious : null,
      growth: followerGrowth,
      delta: followerGrowth == null ? null : pctChange(followers, followersPrevious),
    },
    engagement_rate: { current: engagementRate, previous: prevRate, delta: pctChange(engagementRate || 0, prevRate || 0) },
    series: {
      reach: cur.reach?.values || [],
      views: (cur.views || cur.impressions)?.values || [],
    },
  };
}

function whatWorks(mediaList, days, now = new Date()) {
  const window = periodWindow(days || 30, now);
  const all = (mediaList || []).map((m) => ({
    ...m,
    _date: parseMediaDate(m.timestamp),
    _eng: engagementOf(m),
    _type: contentType(m),
  }));
  const inPeriod = all.filter((m) => m._date && inRange(m._date, window.since, window.until));
  const items = inPeriod.length >= 2 ? inPeriod : all;

  const top_posts = [...items]
    .sort((a, b) => b._eng - a._eng)
    .slice(0, 5)
    .map((m) => ({
      id: m.id,
      caption: String(m.caption || '').slice(0, 160),
      permalink: m.permalink || null,
      thumbnail_url: m.thumbnail_url || m.media_url || null,
      media_type: m._type,
      media_type_label: contentTypeLabel(m._type),
      timestamp: m.timestamp,
      like_count: Number(m.like_count || 0),
      comments_count: Number(m.comments_count || 0),
      engagement: m._eng,
      reach: m.reach != null ? Number(m.reach) : null,
      views: m.views != null ? Number(m.views) : null,
    }));

  const typeMap = new Map();
  for (const m of items) {
    const rec = typeMap.get(m._type) || {
      type: m._type,
      label: contentTypeLabel(m._type),
      posts: 0,
      engagement: 0,
      likes: 0,
      comments: 0,
    };
    rec.posts += 1;
    rec.engagement += m._eng;
    rec.likes += Number(m.like_count || 0);
    rec.comments += Number(m.comments_count || 0);
    typeMap.set(m._type, rec);
  }
  const content_types = [...typeMap.values()]
    .map((t) => ({
      ...t,
      engagement_per_post: t.posts ? Math.round((t.engagement / t.posts) * 10) / 10 : 0,
    }))
    .sort((a, b) => b.engagement_per_post - a.engagement_per_post);

  const dayBuckets = Array.from({ length: 7 }, (_, i) => ({
    weekday: i, label: WEEKDAYS_HE[i], posts: 0, engagement: 0,
  }));
  const hourBuckets = Array.from({ length: 24 }, (_, i) => ({
    hour: i, posts: 0, engagement: 0,
  }));
  for (const m of items) {
    if (!m._date) continue;
    const p = jerusalemParts(m._date);
    dayBuckets[p.weekday].posts += 1;
    dayBuckets[p.weekday].engagement += m._eng;
    hourBuckets[p.hour].posts += 1;
    hourBuckets[p.hour].engagement += m._eng;
  }
  const withAvg = (b) => ({
    ...b,
    engagement_per_post: b.posts ? Math.round((b.engagement / b.posts) * 10) / 10 : 0,
  });
  const daysScored = dayBuckets.map(withAvg).filter((d) => d.posts > 0)
    .sort((a, b) => b.engagement_per_post - a.engagement_per_post);
  const hoursScored = hourBuckets.map(withAvg).filter((h) => h.posts > 0)
    .sort((a, b) => b.engagement_per_post - a.engagement_per_post);

  return {
    top_posts,
    content_types,
    best_content_type: content_types[0] || null,
    days: dayBuckets.map(withAvg),
    hours: hourBuckets.map(withAvg),
    best_days: daysScored.slice(0, 3),
    best_hours: hoursScored.slice(0, 3),
  };
}

function formatHour(h) {
  return `${String(h).padStart(2, '0')}:00`;
}

function clipCaption(text, n = 56) {
  const s = String(text || 'פוסט').replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function describeWhatWorks(works) {
  const parts = [];
  if (works?.top_posts?.[0]) {
    const t = works.top_posts[0];
    parts.push(`התוכן המוביל: ${t.media_type_label} «${clipCaption(t.caption)}» עם ${t.engagement} אינטראקציות.`);
  }
  if (works?.best_content_type) {
    const t = works.best_content_type;
    parts.push(`סוג התוכן שעובד הכי טוב: ${t.label} (בממוצע ${t.engagement_per_post} אינטראקציות לפוסט).`);
  }
  if (works?.best_days?.[0] || works?.best_hours?.[0]) {
    const bits = [];
    if (works.best_days?.[0]) bits.push(`יום ${works.best_days[0].label}`);
    if (works.best_hours?.[0]) bits.push(`סביב ${formatHour(works.best_hours[0].hour)}`);
    parts.push(`הזמנים הכי חזקים לפרסום: ${bits.join(', ')}.`);
  }
  return parts.join(' ');
}

function generateRecommendations({ media, automations = [], comments = [], trends, what_works, now = new Date() } = {}) {
  const recs = [];
  const works = what_works || whatWorks(media, 30, now);

  if (works.best_days?.[0] || works.best_hours?.[0]) {
    const day = works.best_days?.[0];
    const hour = works.best_hours?.[0];
    recs.push({
      id: 'best_time',
      title: 'מתי הכי כדאי לפרסם',
      body: `הקהל שלך מגיב הכי חזק${day ? ` ביום ${day.label}` : ''}${hour ? ` סביב ${formatHour(hour.hour)}` : ''}. נסי לתזמן את הריל הבא לחלון הזה.`,
    });
  }

  if (works.best_content_type && (works.content_types || []).length > 1) {
    const t = works.best_content_type;
    recs.push({
      id: 'content_type',
      title: 'סוג התוכן שכדאי לחזק',
      body: `${t.label} מושך אצלך הכי הרבה מעורבות — בממוצע ${t.engagement_per_post} אינטראקציות לפוסט. שווה להשקיע עוד אחד בסגנון הזה השבוע.`,
    });
  }

  const boundIds = new Set((automations || []).map((a) => a.media_id).filter(Boolean));
  const highComment = [...(media || [])]
    .filter((m) => !boundIds.has(m.id) && Number(m.comments_count || 0) >= 8)
    .sort((a, b) => Number(b.comments_count || 0) - Number(a.comments_count || 0))[0];
  if (highComment) {
    recs.push({
      id: 'automation_opportunity',
      title: 'פוסט שכדאי לחבר לאוטומציה',
      body: `לפוסט «${clipCaption(highComment.caption, 50)}» יש ${highComment.comments_count} תגובות בלי אוטומציה. אפשר לחבר מילת מפתח ולשלוח את הפרטים בפרטי.`,
    });
  }

  const existingKw = new Set();
  for (const a of automations || []) {
    String(a.keywords || '')
      .split(/[,،\n]/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
      .forEach((k) => existingKw.add(k));
  }
  const stop = new Set(['על', 'של', 'עם', 'את', 'זה', 'לא', 'יש', 'או', 'גם', 'לי', 'כל', 'אני', 'שלך', 'מה', 'כי', 'היא', 'הוא', 'the', 'and']);
  const freq = new Map();
  for (const c of comments || []) {
    const text = String(c.text || c.message || c.comment_text || '');
    for (const word of text.split(/\s+/)) {
      const w = word.replace(/[^\u0590-\u05FFa-zA-Z0-9]/g, '').toLowerCase();
      if (w.length < 2 || stop.has(w)) continue;
      freq.set(w, (freq.get(w) || 0) + 1);
    }
  }
  const uncovered = [...freq.entries()]
    .filter(([w, n]) => n >= 3 && !existingKw.has(w))
    .sort((a, b) => b[1] - a[1]);
  if (uncovered[0]) {
    recs.push({
      id: 'missing_keyword',
      title: 'מילת מפתח בלי אוטומציה',
      body: `המילה «${uncovered[0][0]}» הופיעה ${uncovered[0][1]} פעמים בתגובות, ואין לה אוטומציה. אפשר לפתוח אוטומציה חדשה סביבה.`,
    });
  }

  if (trends) {
    const deltaEntries = [];
    if (trends.deltas) {
      for (const [k, v] of Object.entries(trends.deltas)) {
        if (typeof v === 'number') deltaEntries.push([k, v]);
      }
    }
    if (typeof trends.reach?.delta === 'number') deltaEntries.push(['reach', trends.reach.delta]);
    if (typeof trends.views?.delta === 'number') deltaEntries.push(['views', trends.views.delta]);
    const labels = {
      engagement: 'המעורבות',
      likes: 'הלייקים',
      comments: 'התגובות',
      posts: 'מספר הפוסטים',
      reach: 'החשיפה',
      views: 'הצפיות',
    };
    const drops = deltaEntries.filter(([, v]) => v <= -15).sort((a, b) => a[1] - b[1]);
    const ups = deltaEntries.filter(([, v]) => v >= 15).sort((a, b) => b[1] - a[1]);
    if (drops[0]) {
      recs.push({
        id: 'drop_alert',
        title: 'ירידה שכדאי לשים לב אליה',
        body: `${labels[drops[0][0]] || drops[0][0]} ירדה ב-${Math.abs(drops[0][1])}% לעומת התקופה הקודמת. שווה לחזור לפורמט שעבד טוב בשבוע שעבר.`,
      });
    } else if (ups[0]) {
      recs.push({
        id: 'increase_alert',
        title: 'עלייה יפה',
        body: `${labels[ups[0][0]] || ups[0][0]} עלתה ב-${ups[0][1]}% לעומת התקופה הקודמת. זה זמן טוב להמשיך באותו כיוון ולפרסם עוד תוכן דומה.`,
      });
    }
  }

  return recs.slice(0, 3);
}

function metricLabelHe(key) {
  return {
    engagement: 'המעורבות',
    likes: 'הלייקים',
    comments: 'התגובות',
    posts: 'מספר הפוסטים',
    reach: 'החשיפה',
    views: 'הצפיות',
    followers: 'מספר העוקבות',
    engagement_rate: 'אחוז המעורבות',
  }[key] || key;
}

function pickImprovedDropped(trends) {
  const candidates = [];
  const add = (key, delta, current, previous) => {
    if (typeof delta === 'number') {
      candidates.push({ key, delta, current, previous, label: metricLabelHe(key) });
    }
  };
  if (trends?.deltas) {
    add('engagement', trends.deltas.engagement, trends.current?.engagement, trends.previous?.engagement);
    add('likes', trends.deltas.likes, trends.current?.likes, trends.previous?.likes);
    add('comments', trends.deltas.comments, trends.current?.comments, trends.previous?.comments);
  }
  if (trends?.reach) add('reach', trends.reach.delta, trends.reach.current, trends.reach.previous);
  if (trends?.views) add('views', trends.views.delta, trends.views.current, trends.views.previous);
  if (trends?.followers && trends.followers.delta != null) {
    add('followers', trends.followers.delta, trends.followers.current, trends.followers.previous);
  }
  const improved = candidates.filter((c) => c.delta > 0).sort((a, b) => b.delta - a.delta)[0] || null;
  const dropped = candidates.filter((c) => c.delta < 0).sort((a, b) => a.delta - b.delta)[0] || null;
  return { improved, dropped };
}

function buildWeeklySummary({ trends, what_works, recommendations = [], now = new Date() } = {}) {
  const works = what_works || { top_posts: [], content_types: [], best_days: [], best_hours: [], best_content_type: null };
  const { improved, dropped } = pickImprovedDropped(trends || {});
  const improvedText = improved
    ? `${improved.label} עלתה ב-${improved.delta}% לעומת התקופה הקודמת.`
    : 'לא נרשמה עלייה בולטת השבוע — זה זמן טוב לחזור לפורמט שעבד לך לאחרונה.';
  const droppedText = dropped
    ? `${dropped.label} ירדה ב-${Math.abs(dropped.delta)}% לעומת התקופה הקודמת.`
    : 'לא נרשמה ירידה בולטת — היציבות נשמרת.';
  const rec = recommendations[0];
  const recommendationText = rec
    ? rec.body
    : 'פרסמי ריל ביום ובשעה שבהם הקהל שלך הכי פעיל, וחברי אוטומציה לפוסט עם הרבה תגובות.';
  const whatWorksText = describeWhatWorks(works) || 'עדיין אין מספיק פוסטים בתקופה כדי לזהות דפוס ברור.';

  const points = {
    improved: improvedText,
    dropped: droppedText,
    recommendation: recommendationText,
    what_works: {
      text: whatWorksText,
      top_posts: (works.top_posts || []).slice(0, 3),
      best_content_type: works.best_content_type || works.content_types?.[0] || null,
      best_days: (works.best_days || []).slice(0, 3),
      best_hours: (works.best_hours || []).slice(0, 3),
    },
  };

  const body = [
    'הסיכום השבועי שלך',
    `מה השתפר: ${improvedText}`,
    `מה ירד: ${droppedText}`,
    `מה עובד: ${whatWorksText}`,
    `המלצה: ${recommendationText}`,
  ].join('\n\n');

  return {
    week_start: weekStartSundayJerusalem(now),
    points,
    body,
  };
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function renderSummaryEmail({ accountName, username, summary } = {}) {
  const p = summary?.points || {};
  const works = p.what_works || {};
  const days = (works.best_days || []).map((d) => d.label).filter(Boolean).join(', ');
  const hours = (works.best_hours || []).map((h) => formatHour(h.hour)).filter(Boolean).join(', ');
  const type = works.best_content_type?.label;
  const who = accountName || (username ? `@${username}` : 'רונה');

  const topLines = (works.top_posts || []).map((t, i) =>
    `${i + 1}. ${t.media_type_label || ''} — ${clipCaption(t.caption, 80)} (${t.engagement || 0} אינטראקציות)`
  );

  const text = [
    `שלום ${who},`,
    '',
    summary?.body || '',
    '',
    'מה עובד',
    type ? `סוג תוכן מוביל: ${type}` : '',
    days ? `ימים חזקים: ${days}` : '',
    hours ? `שעות חזקות: ${hours}` : '',
    topLines.length ? `פוסטים ורילס מובילים:\n${topLines.join('\n')}` : '',
    '',
    'נשלח אוטומטית מאפליקציית רונה. האפליקציה לא שולחת פניות לשיתופי פעולה בשמך.',
  ].filter((line, i, arr) => line !== '' || (arr[i - 1] !== '' && i !== arr.length - 1)).join('\n');

  const topHtml = (works.top_posts || []).map((t) =>
    `<li>${escapeHtml(`${t.media_type_label || ''} — ${clipCaption(t.caption, 80)} (${t.engagement || 0} אינטראקציות)`)}</li>`
  ).join('');

  const html = `<!doctype html>
<html lang="he" dir="rtl"><head><meta charset="utf-8">
<style>
  body { font-family: Assistant, Heebo, Arial, sans-serif; background:#F7F0EA; color:#3B2A2E; margin:0; padding:24px; }
  .card { background:#fff; border-radius:20px; padding:24px; max-width:560px; margin:0 auto; }
  h1 { font-size:22px; margin:0 0 8px; }
  h2 { font-size:16px; color:#C45C7A; margin:20px 0 8px; }
  p { line-height:1.65; margin:0 0 10px; }
  li { margin-bottom:6px; }
  .foot { color:#8A7176; font-size:13px; margin-top:24px; }
</style></head>
<body><div class="card">
  <h1>הסיכום השבועי שלך</h1>
  <p>שלום ${escapeHtml(who)},</p>
  <h2>מה השתפר</h2><p>${escapeHtml(p.improved || '')}</p>
  <h2>מה ירד</h2><p>${escapeHtml(p.dropped || '')}</p>
  <h2>מה עובד</h2>
  <p>${escapeHtml(works.text || '')}</p>
  ${type ? `<p>סוג תוכן מוביל: <strong>${escapeHtml(type)}</strong></p>` : ''}
  ${days ? `<p>ימים חזקים: <strong>${escapeHtml(days)}</strong></p>` : ''}
  ${hours ? `<p>שעות חזקות: <strong>${escapeHtml(hours)}</strong></p>` : ''}
  ${topHtml ? `<p>פוסטים ורילס מובילים:</p><ol>${topHtml}</ol>` : ''}
  <h2>המלצה</h2><p>${escapeHtml(p.recommendation || '')}</p>
  <p class="foot">נשלח אוטומטית מאפליקציית רונה. האפליקציה לא שולחת פניות לשיתופי פעולה בשמך.</p>
</div></body></html>`;

  return { subject: 'הסיכום השבועי שלך · רונה', text, html };
}

module.exports = {
  CONTENT_TYPE_LABELS,
  contentType,
  contentTypeLabel,
  engagementOf,
  periodWindow,
  pctChange,
  parseGraphInsights,
  computeMediaTrends,
  mergeAccountInsights,
  whatWorks,
  describeWhatWorks,
  generateRecommendations,
  buildWeeklySummary,
  renderSummaryEmail,
  formatHour,
  clipCaption,
  pickImprovedDropped,
};
