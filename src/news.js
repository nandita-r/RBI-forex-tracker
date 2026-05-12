const Parser = require('rss-parser');
const parser = new Parser({ timeout: 10000, headers: { 'User-Agent': 'RBIForexTracker/1.0' } });

const FEEDS = [
  { name: 'RBI',                    url: 'https://www.rbi.org.in/Scripts/rss.aspx',                              category: 'policy'  },
  { name: 'Economic Times Markets', url: 'https://economictimes.indiatimes.com/markets/rss.cms',                  category: 'macro'   },
  { name: 'Economic Times Economy', url: 'https://economictimes.indiatimes.com/news/economy/rss.cms',             category: 'macro'   },
  { name: 'Business Standard',      url: 'https://www.business-standard.com/rss/finance.rss',                     category: 'macro'   },
  { name: 'Mint Economy',           url: 'https://www.livemint.com/rss/economy',                                  category: 'macro'   },
  { name: 'Financial Express',      url: 'https://www.financialexpress.com/feed/',                                 category: 'macro'   },
];

const RELEVANCE_KEYWORDS = [
  'forex','foreign exchange','rupee','rbi','reserve bank',
  'current account','capital account','fpi','fdi','fii',
  'dollar','usd','inr','crude oil','oil price','gold import',
  'forward book','intervention','import cover','trade deficit',
  'ndf','remittance','external debt','balance of payments',
  'foreign reserves','forex kitty','exchange rate',
];

const POSITIVE_SIGNALS = [
  'reserves rise','reserves increase','reserves surge','reserves climb',
  'rupee strengthens','rupee gains','rupee appreciates','rupee rallies',
  'inflows','fpi inflow','fdi inflow','capital inflows',
  'rbi buys dollar','rbi accumulates','gold monetisation',
  'current account surplus','trade surplus','remittances rise',
  'exports grow','nri deposits','import restriction','import duty raised',
  'rupee stable','forward book shrinks','reserves recover','dollar inflow',
];

const NEGATIVE_SIGNALS = [
  'reserves fall','reserves drop','reserves decline','reserves shrink',
  'reserves plunge','reserves dip','reserves drain',
  'rupee falls','rupee weakens','rupee depreciates','rupee slides',
  'rupee hits low','rupee record low','rupee under pressure',
  'outflows','fpi outflow','capital outflows','sell-off',
  'rbi sells dollar','dollar selling','current account deficit widens',
  'trade deficit widens','oil prices rise','crude surges','brent rises',
  'oil above','import bill rises','gold imports surge',
  'forward book rises','forward book hits record','short position rises',
  'dollar demand','rupee pressure','reserve depletion',
];

const CATEGORY_MAP = {
  intervention: ['intervention','rbi sells','rbi buys','forward book','ndf','spot market','open position'],
  policy:       ['rbi policy','repo rate','monetary policy','rbi circular','rbi notification','rbi governor'],
  flows:        ['fpi','fdi','fii','capital flows','inflows','outflows','remittance'],
  trade:        ['trade deficit','current account','exports','imports','import bill','trade balance'],
  geopolitical: ['iran','middle east','war','sanctions','strait','geopolit','conflict','opec'],
  macro:        ['gdp','inflation','cpi','wpi','rate hike','fed','federal reserve','dollar index'],
};

function scoreText(text) {
  const lower = text.toLowerCase();
  let pos = 0, neg = 0;
  for (const kw of POSITIVE_SIGNALS) if (lower.includes(kw)) pos++;
  for (const kw of NEGATIVE_SIGNALS) if (lower.includes(kw)) neg++;
  if (pos > neg) return 'pos';
  if (neg > pos) return 'neg';
  return 'neu';
}

function detectCategory(text) {
  const lower = text.toLowerCase();
  for (const [cat, keywords] of Object.entries(CATEGORY_MAP)) {
    if (keywords.some(kw => lower.includes(kw))) return cat;
  }
  return 'macro';
}

function isRelevant(text) {
  const lower = text.toLowerCase();
  return RELEVANCE_KEYWORDS.some(kw => lower.includes(kw));
}

function timeAgo(dateStr) {
  try {
    const diffMs = Date.now() - new Date(dateStr).getTime();
    const h = Math.floor(diffMs / 3600000);
    const d = Math.floor(diffMs / 86400000);
    if (h < 1)  return 'Just now';
    if (h < 24) return `${h}h ago`;
    if (d === 1) return '1 day ago';
    if (d < 7)  return `${d} days ago`;
    return `${Math.floor(d/7)} week${Math.floor(d/7)>1?'s':''} ago`;
  } catch { return 'Recently'; }
}

function truncate(str, max = 25) {
  const words = (str || '').replace(/<[^>]+>/g, '').trim().split(/\s+/);
  return words.length <= max ? words.join(' ') : words.slice(0, max).join(' ') + '...';
}

async function fetchFeed(feed) {
  try {
    const result = await parser.parseURL(feed.url);
    return (result.items || []).map(item => ({
      title: item.title || '',
      summary: item.contentSnippet || item.content || '',
      pubDate: item.pubDate || item.isoDate || new Date().toISOString(),
      source: feed.name,
      link: item.link || '',
    }));
  } catch (err) {
    console.warn(`[RSS] ${feed.name} failed: ${err.message}`);
    return [];
  }
}

async function fetchForexNews() {
  console.log('[News] Fetching RSS feeds...');
  const results = await Promise.allSettled(FEEDS.map(f => fetchFeed(f)));
  const allItems = results.filter(r => r.status === 'fulfilled').flatMap(r => r.value);
  const relevant = allItems.filter(i => isRelevant(i.title + ' ' + i.summary));

  const scored = relevant.map(item => {
    const full = item.title + ' ' + item.summary;
    return {
      impact: scoreText(full),
      text: truncate(item.title, 25),
      source: item.source,
      age: timeAgo(item.pubDate),
      category: detectCategory(full),
      link: item.link,
    };
  });

  const sorted = [
    ...scored.filter(i => i.impact === 'neg'),
    ...scored.filter(i => i.impact === 'pos'),
    ...scored.filter(i => i.impact === 'neu'),
  ];

  const seen = new Set();
  const deduped = sorted.filter(item => {
    const key = item.text.slice(0, 40).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 20);

  console.log(`[News] ${deduped.length} relevant items fetched`);

  return {
    success: deduped.length > 0,
    source: deduped.length > 0 ? 'rss_live' : 'rss_empty',
    items: deduped.length > 0 ? deduped : getStaticNews(),
    fetchedAt: new Date().toISOString(),
  };
}

function getStaticNews() {
  return [
    { impact:'neg', text:'RBI forex reserves fall $7.79B in week ending May 1 as dollar selling defends rupee.', source:'RBI WSS', age:'3 days ago', category:'intervention' },
    { impact:'neg', text:'Brent crude above $105/barrel widens India oil import bill and current account deficit.', source:'Reuters', age:'1 day ago', category:'trade' },
    { impact:'neg', text:'FPI outflows from Indian equities reach $21B YTD 2026, sustained rupee selling pressure.', source:'SEBI', age:'2 days ago', category:'flows' },
    { impact:'pos', text:'RBI caps bank net open positions at $100M each, curbing speculative dollar demand.', source:'RBI circular', age:'6 weeks ago', category:'policy' },
    { impact:'pos', text:'RBI bans INR NDF contracts for authorised dealers, closing offshore arbitrage channel.', source:'RBI notification', age:'6 weeks ago', category:'policy' },
    { impact:'neg', text:'RBI net short forward book hits record $103B in March — future dollar obligations mount.', source:'Bloomberg', age:'2 weeks ago', category:'intervention' },
    { impact:'pos', text:'PM Modi appeals for reduced gold imports and foreign travel to conserve dollar reserves.', source:'PTI', age:'1 day ago', category:'policy' },
    { impact:'neg', text:'USD/INR approaches 95 level; RBI must sell dollars to prevent disorderly depreciation.', source:'FX Leaders', age:'1 day ago', category:'intervention' },
    { impact:'pos', text:'RBI holds repo rate at 5.25%, maintains stability focus amid global uncertainty.', source:'DD News', age:'1 week ago', category:'macro' },
    { impact:'neg', text:'Current account deficit risks exceeding 3% of GDP as oil above $105 widens trade gap.', source:'MUFG Research', age:'4 days ago', category:'macro' },
  ];
}

module.exports = { fetchForexNews };
