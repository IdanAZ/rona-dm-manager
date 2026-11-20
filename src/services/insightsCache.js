const DEFAULT_TTL_MS = 12 * 60 * 1000;

const store = new Map();

function keyOf(accountId, days) {
  return String(accountId) + ':' + String(Number(days) === 7 ? 7 : 30);
}

function peekInsightsCache(accountId, days) {
  return store.get(keyOf(accountId, days)) || null;
}

function clearInsightsCache(accountId, days) {
  if (accountId == null) {
    store.clear();
    return;
  }
  if (days == null) {
    const prefix = String(accountId) + ':';
    for (const key of [...store.keys()]) {
      if (key.startsWith(prefix)) store.delete(key);
    }
    return;
  }
  store.delete(keyOf(accountId, days));
}

function decorate(entry, { stale = false, refreshing = false, cacheHit = true } = {}) {
  return {
    ...entry.data,
    cached: !!cacheHit,
    stale: !!stale,
    refreshing: !!refreshing,
    cache_age_ms: Math.max(0, Date.now() - (entry.fetchedAt || 0)),
  };
}

function startRefresh(key, collect) {
  let current = store.get(key);
  if (current && current.refreshing && current.promise) return current.promise;
  if (!current) {
    current = { data: null, fetchedAt: 0, refreshing: false, promise: null };
    store.set(key, current);
  }
  current.refreshing = true;
  current.promise = Promise.resolve()
    .then(() => collect())
    .then((data) => {
      store.set(key, {
        data,
        fetchedAt: Date.now(),
        refreshing: false,
        promise: null,
      });
      return data;
    })
    .catch((err) => {
      const cur = store.get(key);
      if (cur) {
        cur.refreshing = false;
        cur.promise = null;
      }
      throw err;
    });
  return current.promise;
}

async function getCachedInsights({
  collect,
  account,
  days = 30,
  ttlMs = DEFAULT_TTL_MS,
  wait = true,
  force = false,
  now = Date.now(),
} = {}) {
  if (typeof collect !== 'function') throw new Error('collect required');
  const key = keyOf(account && account.id, days);
  const entry = store.get(key);
  const hasData = !!(entry && entry.data);
  const fresh = hasData && (now - entry.fetchedAt) < ttlMs;

  if (!force && hasData && fresh) {
    return decorate(entry, { stale: false, refreshing: !!entry.refreshing, cacheHit: true });
  }

  if (!force && hasData && !wait) {
    const promise = startRefresh(key, collect);
    promise.catch(() => {});
    return decorate(entry, { stale: true, refreshing: true, cacheHit: true });
  }

  try {
    const data = await startRefresh(key, collect);
    return { ...data, cached: false, stale: false, refreshing: false, cache_age_ms: 0 };
  } catch (err) {
    if (hasData) {
      return {
        ...decorate(entry, { stale: true, refreshing: false, cacheHit: true }),
        refresh_error: err.message,
      };
    }
    throw err;
  }
}

module.exports = {
  INSIGHTS_CACHE_TTL_MS: DEFAULT_TTL_MS,
  getCachedInsights,
  clearInsightsCache,
  peekInsightsCache,
};
