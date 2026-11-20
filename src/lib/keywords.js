function normalize(s) {
  return String(s || '')
    .normalize('NFC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function parseKeywords(raw) {
  if (Array.isArray(raw)) return raw.map(normalize).filter(Boolean);
  return normalize(raw)
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Match a comment against automation keyword settings.
 * Hebrew-safe, case/whitespace-insensitive.
 */
function matchesComment({ text, keywordMode, keywords, matchType }) {
  if (keywordMode === 'any') return true;
  const t = normalize(text);
  if (!t) return false;
  const keys = parseKeywords(keywords);
  if (!keys.length) return false;
  return keys.some((k) => {
    if (!k) return false;
    if (matchType === 'contains') return t.includes(k);
    const re = new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(k)}(?![\\p{L}\\p{N}_])`, 'u');
    return re.test(t);
  });
}

module.exports = { normalize, parseKeywords, matchesComment };
