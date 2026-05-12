require('dotenv').config();
const express = require('express');
const cron = require('node-cron');
const cors = require('cors');
const path = require('path');
const { fetchRBIReserves } = require('./src/scraper');
const { fetchForexNews } = require('./src/news');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// In-memory cache
let reserveCache = null;
let newsCache = null;
let lastReserveFetch = null;
let lastNewsFetch = null;

const RESERVE_CACHE_TTL_MS = 60 * 60 * 1000;      // 1 hour
const NEWS_CACHE_TTL_MS   = 30 * 60 * 1000;        // 30 minutes

function isCacheStale(lastFetch, ttl) {
  if (!lastFetch) return true;
  return (Date.now() - lastFetch) > ttl;
}

// Refresh reserve data
async function refreshReserves(force = false) {
  if (!force && !isCacheStale(lastReserveFetch, RESERVE_CACHE_TTL_MS)) {
    return reserveCache;
  }
  console.log('[Cache] Refreshing RBI reserve data...');
  const data = await fetchRBIReserves();
  reserveCache = data;
  lastReserveFetch = Date.now();
  console.log(`[Cache] Reserves updated — gross: $${data.gross}B, usable: $${data.usable}B`);
  return data;
}

// Refresh news
async function refreshNews(force = false) {
  if (!force && !isCacheStale(lastNewsFetch, NEWS_CACHE_TTL_MS)) {
    return newsCache;
  }
  console.log('[Cache] Refreshing news feed...');
  const data = await fetchForexNews(process.env.ANTHROPIC_API_KEY);
  newsCache = data;
  lastNewsFetch = Date.now();
  console.log(`[Cache] News updated — ${data.items?.length || 0} items`);
  return data;
}

// ── API Routes ────────────────────────────────────────────────

// GET /api/reserves — returns current reserve data
app.get('/api/reserves', async (req, res) => {
  try {
    const force = req.query.refresh === 'true';
    const data = await refreshReserves(force);
    res.json({ ok: true, data, cachedAt: new Date(lastReserveFetch).toISOString() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/news — returns impact-assessed news feed
app.get('/api/news', async (req, res) => {
  try {
    const force = req.query.refresh === 'true';
    const data = await refreshNews(force);
    res.json({ ok: true, data, cachedAt: new Date(lastNewsFetch).toISOString() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/all — reserves + news in one call (what the frontend uses)
app.get('/api/all', async (req, res) => {
  try {
    const force = req.query.refresh === 'true';
    const [reserves, news] = await Promise.all([
      refreshReserves(force),
      refreshNews(force),
    ]);
    res.json({
      ok: true,
      reserves,
      news,
      serverTime: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/health
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    uptime: Math.round(process.uptime()),
    reserveCache: !!reserveCache,
    newsCache: !!newsCache,
    lastReserveFetch: lastReserveFetch ? new Date(lastReserveFetch).toISOString() : null,
    lastNewsFetch: lastNewsFetch ? new Date(lastNewsFetch).toISOString() : null,
  });
});

// ── Scheduled Jobs ────────────────────────────────────────────

// RBI publishes WSS every Friday ~6pm IST — run cron at 6:30pm IST (13:00 UTC) Friday
cron.schedule('0 13 * * 5', async () => {
  console.log('[Cron] Friday WSS refresh triggered');
  await refreshReserves(true);
}, { timezone: 'UTC' });

// Refresh news every 2 hours
cron.schedule('0 */2 * * *', async () => {
  console.log('[Cron] Scheduled news refresh');
  await refreshNews(true);
});

// ── Startup ───────────────────────────────────────────────────

app.listen(PORT, async () => {
  console.log(`\n🏦  RBI Forex Tracker running on http://localhost:${PORT}`);
  console.log(`📊  API: http://localhost:${PORT}/api/all`);
  console.log(`\nPre-loading data...`);
  await Promise.all([refreshReserves(true), refreshNews(true)]);
  console.log('✅  Ready\n');
});

module.exports = app;
