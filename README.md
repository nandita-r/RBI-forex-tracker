# RBI Forex Tracker

A live weekly dashboard showing India's **true usable forex reserves** — adjusted for gold, the RBI's net short forward book, and SDRs — with an AI-powered news feed assessing the impact of RBI/GOI actions on the forex kitty.

## What it shows

| Metric | Source |
|--------|--------|
| Gross reserves | RBI Weekly Statistical Supplement (scraped Fridays) |
| Less: Gold | RBI WSS table 2 |
| Less: Net short forward book | RBI monthly FX derivatives data (updated manually) |
| Less: SDRs + IMF tranche | RBI WSS table 2 |
| **= True usable reserves** | Calculated |
| Import cover | Based on DGCI&S monthly import data |

## Quick start (localhost)

```bash
# 1. Install dependencies
npm install

# 2. Set up environment
cp .env.example .env
# Edit .env and add your Anthropic API key

# 3. Start server
npm start

# Open http://localhost:3000
```

## Deploy to the web (free options)

### Option A — Railway (recommended, easiest)
1. Push this folder to a GitHub repo
2. Go to https://railway.app → New Project → Deploy from GitHub
3. Add environment variable: `ANTHROPIC_API_KEY=sk-ant-...`
4. Railway gives you a public URL like `https://rbi-tracker.up.railway.app`

### Option B — Render
1. Push to GitHub
2. Go to https://render.com → New Web Service → connect repo
3. Build command: `npm install`
4. Start command: `npm start`
5. Add env var `ANTHROPIC_API_KEY`
6. Free tier spins down after inactivity — use paid ($7/mo) for always-on

### Option C — Fly.io
```bash
npm install -g flyctl
fly launch
fly secrets set ANTHROPIC_API_KEY=sk-ant-...
fly deploy
```

### Option D — Your own VPS (DigitalOcean / Hetzner)
```bash
# On server
git clone your-repo && cd rbi-tracker
npm install
cp .env.example .env && nano .env

# Run with PM2 (keeps alive on reboot)
npm install -g pm2
pm2 start server.js --name rbi-tracker
pm2 startup && pm2 save

# Nginx reverse proxy (optional, for custom domain)
# Point your domain's DNS A record to server IP
# Then configure nginx to proxy port 80 → 3000
```

## Keeping data fresh

### Forex reserves (automatic)
- Server scrapes RBI's Weekly Statistical Supplement every **Friday at 6:30pm IST**
- RBI typically publishes around 6pm IST on Fridays
- Hit the Refresh button in the UI at any time to force a pull

### Forward book (manual, monthly)
RBI publishes its FX derivatives data with a ~6 week lag. When new data arrives:
1. Open `src/scraper.js`
2. Update the `KNOWN_FORWARD_BOOK` object:
```js
const KNOWN_FORWARD_BOOK = {
  '2026-04': 98.5,   // ← add new month
  '2026-03': 103.0,
  ...
};
```
3. Restart server (`pm2 restart rbi-tracker`)

### Monthly imports (quarterly)
Update `MONTHLY_IMPORTS` in `src/scraper.js` when DGCI&S releases quarterly trade data.

## API endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/all` | Reserves + news (used by frontend) |
| `GET /api/reserves` | Reserve data only |
| `GET /api/news` | AI news feed only |
| `GET /api/health` | Server status + cache info |
| `GET /api/all?refresh=true` | Force bypass cache |

## Caveats
- RBI's WSS is a rendered HTML page — if RBI changes the page format, the scraper may need updating
- The forward book figure uses the latest known monthly data (not weekly) — it lags by ~6 weeks
- Import cover is estimated from DGCI&S data updated quarterly
- The AI news feed uses Claude to assess impact; treat as indicative, not definitive
