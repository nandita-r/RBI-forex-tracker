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

let reserveCache = null;
let newsCache = null;
let lastReserveFetch = null;
let lastNewsFetch = null;

const RESERVE_TTL = 60 * 60 * 1000;
const NEWS_TTL    = 30 * 60 * 1000;

function isStale(last, ttl) {
  if (!last) return true;
  return (Date.now() - last) > ttl;
}

async function refreshReserves(force = false) {
  if (!force && !isStale(lastReserveFetch, RESERVE_TTL)) return reserveCache;
  console.log('[Cache] Refreshing reserves...');
  reserveCache = await fetchRBIReserves();
  lastReserveFetch = Date.now();
  console.log(`[Cache] Reserves: $${reserveCache.gross}B gross, $${reserveCache.usable}B usable`);
  return reserveCache;
}

async function refreshNews(force = false) {
  if (!force && !isStale(lastNewsFetch, NEWS_TTL)) return newsCache;
  console.log('[Cache] Refreshing news...');
  newsCache = await fetchForexNews();
  lastNewsFetch = Date.now();
  console.log(`[Cache] News: ${newsCache.items?.length || 0} items`);
  return newsCache;
}

app.get('/api/reserves', async (req, res) => {
  try {
    const data = await refreshReserves(req.query.refresh === 'true');
    res.json({ ok: true, data, cachedAt: new Date(lastReserveFetch).toISOString() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/news', async (req, res) => {
  try {
    const data = await refreshNews(req.query.refresh === 'true');
    res.json({ ok: true, data, cachedAt: new Date(lastNewsFetch).toISOString() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/all', async (req, res) => {
  try {
    const force = req.query.refresh === 'true';
    const [reserves, news] = await Promise.all([
      refreshReserves(force),
      refreshNews(force),
    ]);
    res.json({ ok: true, reserves, news, serverTime: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

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

// Scrape RBI every Friday 6:30pm IST (13:00 UTC)
cron.schedule('0 13 * * 5', async () => {
  console.log('[Cron] Friday WSS refresh');
  await refreshReserves(true);
}, { timezone: 'UTC' });

// Refresh news every 2 hours
cron.schedule('0 */2 * * *', async () => {
  console.log('[Cron] News refresh');
  await refreshNews(true);
});

app.listen(PORT, async () => {
  console.log(`\n RBI Forex Tracker on http://localhost:${PORT}`);
  await Promise.all([refreshReserves(true), refreshNews(true)]);
  console.log('Ready\n');
});

module.exports = app;
