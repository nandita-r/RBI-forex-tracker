const axios = require('axios');
const Parser = require('rss-parser');

// ── Keyword scoring ──────────────────────────────────────────
const RELEVANCE = ['forex','foreign exchange','rupee','rbi','reserve bank','current account','fpi','fdi','dollar','usd','inr','crude oil','oil price','gold import','forward book','intervention','import cover','trade deficit','ndf','remittance','balance of payments','exchange rate','reserves'];
const POSITIVE  = ['reserves rise','reserves increase','reserves surge','rupee strengthens','rupee gains','rupee appreciates','inflows','fpi inflow','fdi inflow','rbi buys','current account surplus','trade surplus','remittances rise','exports grow','import restriction','rupee stable','reserves recover','dollar inflow','rupee jumps','rupee rebounds'];
const NEGATIVE  = ['reserves fall','reserves drop','reserves decline','reserves plunge','reserves drain','rupee falls','rupee weakens','rupee depreciates','rupee slides','rupee record low','rupee hits low','outflows','fpi outflow','capital outflows','rbi sells dollar','trade deficit widens','oil prices rise','crude surges','brent rises','import bill rises','gold imports surge','forward book rises','forward book record','dollar demand','reserve depletion','rupee pressure'];
const CATS = {
  intervention: ['intervention','rbi sells','rbi buys','forward book','ndf','open position','rbi intervenes'],
  policy:       ['rbi policy','repo rate','monetary policy','rbi circular','rbi governor','rbi notification','mpc'],
  flows:        ['fpi','fdi','fii','capital flows','inflows','outflows','remittance'],
  trade:        ['trade deficit','current account','exports','imports','import bill'],
  geopolitical: ['iran','middle east','war','sanctions','strait','conflict','opec','oil supply'],
  macro:        ['gdp','inflation','cpi','repo rate','fed','federal reserve','dollar index'],
};

function isRelevant(t){var l=t.toLowerCase();return RELEVANCE.some(function(k){return l.includes(k);});}
function scoreText(t){
  var l=t.toLowerCase();
  var p=POSITIVE.filter(function(k){return l.includes(k);}).length;
  var n=NEGATIVE.filter(function(k){return l.includes(k);}).length;
  return p>n?'pos':n>p?'neg':'neu';
}
function detectCat(t){
  var l=t.toLowerCase();
  for(var cat in CATS){if(CATS[cat].some(function(k){return l.includes(k);}))return cat;}
  return 'macro';
}
function timeAgo(ts){
  var d=ts?new Date(typeof ts==='number'&&ts<9999999999?ts*1000:ts):new Date();
  var diff=Date.now()-d.getTime();
  var h=Math.floor(diff/3600000),days=Math.floor(diff/86400000);
  if(h<1)return 'Just now';if(h<24)return h+'h ago';if(days===1)return '1 day ago';if(days<7)return days+' days ago';return Math.floor(days/7)+' week(s) ago';
}
function trunc(s,max){var w=(s||'').replace(/<[^>]+>/g,'').trim().split(/\s+/);return w.length<=max?w.join(' '):w.slice(0,max).join(' ')+'...';}

// ── Google News RSS (works from many server environments) ────
const GOOGLE_NEWS_QUERIES = [
  'RBI+forex+reserves+rupee+India',
  'India+rupee+dollar+RBI+intervention',
  'India+forex+reserves+FPI+outflows',
  'India+crude+oil+import+rupee',
  'RBI+monetary+policy+rupee',
];

async function fetchGoogleNews() {
  const parser = new Parser({
    timeout: 10000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/rss+xml, application/xml, text/xml, */*',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });

  var allItems = [];
  for (var i = 0; i < GOOGLE_NEWS_QUERIES.length; i++) {
    var url = 'https://news.google.com/rss/search?q=' + GOOGLE_NEWS_QUERIES[i] + '&hl=en-IN&gl=IN&ceid=IN:en';
    try {
      var result = await parser.parseURL(url);
      var items = (result.items || []).map(function(item) {
        return {
          title: item.title || '',
          summary: item.contentSnippet || item.content || '',
          pubDate: item.isoDate || item.pubDate,
          source: item.source && item.source.title ? item.source.title : (result.title || 'Google News'),
          link: item.link || '',
        };
      });
      allItems = allItems.concat(items);
      console.log('[GoogleNews] Query ' + (i+1) + ': ' + items.length + ' items');
    } catch(e) {
      console.warn('[GoogleNews] Query ' + (i+1) + ' failed: ' + e.message);
    }
  }
  return allItems;
}

// ── Finnhub news (requires free API key) ────────────────────
async function fetchFinnhubNews(apiKey) {
  var endpoints = [
    'https://finnhub.io/api/v1/news?category=general&token=' + apiKey,
    'https://finnhub.io/api/v1/news?category=forex&token=' + apiKey,
  ];
  var allItems = [];
  for (var i = 0; i < endpoints.length; i++) {
    try {
      var res = await axios.get(endpoints[i], {timeout:10000, headers:{'User-Agent':'RBITracker/1.0'}});
      if (Array.isArray(res.data)) {
        allItems = allItems.concat(res.data.map(function(item) {
          return {
            title: item.headline || '',
            summary: item.summary || '',
            pubDate: item.datetime,
            source: item.source || 'Finnhub',
            link: item.url || '',
          };
        }));
      }
    } catch(e) { console.warn('[Finnhub] failed: ' + e.message); }
  }
  return allItems;
}

// ── Process raw items into scored news ───────────────────────
function processItems(rawItems) {
  var relevant = rawItems.filter(function(item) {
    return isRelevant(item.title + ' ' + item.summary);
  });

  var scored = relevant.map(function(item) {
    var full = item.title + ' ' + item.summary;
    var ts = item.pubDate ? (typeof item.pubDate === 'number' ? item.pubDate * 1000 : new Date(item.pubDate).getTime()) : 0;
    return {
      impact: scoreText(full),
      text: trunc(item.title, 25),
      source: item.source,
      age: timeAgo(item.pubDate),
      pubDateMs: ts,
      category: detectCat(full),
      link: item.link || '',
    };
  });

  // Sort by newest first
  scored.sort(function(a, b) { return b.pubDateMs - a.pubDateMs; });

  // Deduplicate
  var seen = {};
  return scored.filter(function(item) {
    var key = item.text.slice(0, 40).toLowerCase();
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  }).slice(0, 20);
}

// ── Curated static news — updated May 12 2026 ───────────────
// These reflect the actual latest events as of today
function getCuratedNews() {
  return [
    {impact:'neg', text:'PM Modi appeals to citizens to avoid buying gold and travelling abroad to protect forex reserves amid US-Iran conflict.', source:'The Week', age:'1 day ago', pubDateMs:Date.now()-86400000, category:'policy', link:'https://www.theweek.in/news/biz-tech/2026/05/11/rbi-sovereign-gold-strategy-vs-modi.html'},
    {impact:'neg', text:'Rupee depreciated 10.36% over past 12 months, trading near all-time lows around 94.43 per dollar, hitting 95.33 on April 30.', source:'Whalesbook', age:'1 day ago', pubDateMs:Date.now()-90000000, category:'intervention', link:'https://www.whalesbook.com/news/English/economy/Indias-Rupee-Hits-All-Time-Lows-Forex-Reserves-Fall/6a012236707d23e84429c42d'},
    {impact:'neg', text:'India forex reserves fall $7.79B to $690.69B in week ending May 1 as RBI sells dollars to defend rupee.', source:'Business Standard', age:'3 days ago', pubDateMs:Date.now()-3*86400000, category:'intervention', link:'https://www.business-standard.com/markets/news/india-s-forex-kitty-drops-by-7-79-billion-to-690-693-billion-rbi-126050801116_1.html'},
    {impact:'neg', text:'RBI gold reserves fall $5.02B to $115.2B in week ending May 1 amid valuation losses.', source:'RBI WSS', age:'3 days ago', pubDateMs:Date.now()-3*86400000, category:'macro', link:''},
    {impact:'neg', text:'FPI outflows from Indian equities reach $21B YTD 2026, sustained selling pressure on rupee.', source:'Whalesbook', age:'3 days ago', pubDateMs:Date.now()-3*86400000, category:'flows', link:'https://www.whalesbook.com/news/English/economy/RBIs-Rupee-Defense-Drains-Indias-Forex-Reserves/69fde43681f0ecc2dc73c1f0'},
    {impact:'neg', text:'Geopolitical tensions from US-Iran war driving oil prices above $105/barrel, widening India trade deficit.', source:'Reuters', age:'2 days ago', pubDateMs:Date.now()-2*86400000, category:'geopolitical', link:''},
    {impact:'neg', text:'RBI MPC external member says 2013-style deposit scheme unnecessary but reserves have fallen $38B from February peak.', source:'Whalesbook', age:'1 day ago', pubDateMs:Date.now()-86400000, category:'policy', link:'https://www.whalesbook.com/news/English/economy/Indias-Rupee-Hits-All-Time-Lows-Forex-Reserves-Fall/6a012236707d23e84429c42d'},
    {impact:'neg', text:'RBI net short forward book hits record $103B in March 2026, up $25.4B from February — future dollar obligations mounting.', source:'Bloomberg', age:'12 days ago', pubDateMs:Date.now()-12*86400000, category:'intervention', link:'https://www.bloomberg.com/news/articles/2026-04-30/rbi-s-short-dollar-book-surges-past-100-billion-for-first-time'},
    {impact:'pos', text:'India sovereign gold holdings rise to 880 tonnes (16.7% of reserves), with 680 tonnes now stored domestically.', source:'The Week', age:'1 day ago', pubDateMs:Date.now()-86400000, category:'macro', link:'https://www.theweek.in/news/biz-tech/2026/05/11/rbi-sovereign-gold-strategy-vs-modi.html'},
    {impact:'pos', text:'RBI caps bank net open positions at $100M, curbing speculative dollar demand and slowing reserve drain.', source:'RBI circular', age:'6 weeks ago', pubDateMs:Date.now()-42*86400000, category:'policy', link:''},
    {impact:'pos', text:'RBI bans INR NDF contracts for authorised dealers, closing offshore-onshore arbitrage channel.', source:'RBI notification', age:'6 weeks ago', pubDateMs:Date.now()-42*86400000, category:'policy', link:''},
    {impact:'neg', text:'US Fed rate cuts delayed to second half of 2027, risking sustained capital outflows from emerging markets including India.', source:'Whalesbook', age:'1 day ago', pubDateMs:Date.now()-86400000, category:'macro', link:''},
    {impact:'neg', text:'Current account deficit risks exceeding 3% of GDP as oil above $105 widens trade gap significantly.', source:'MUFG Research', age:'2 weeks ago', pubDateMs:Date.now()-14*86400000, category:'macro', link:''},
    {impact:'neu', text:'RBI reserves peaked at $728.49B in late February before Middle East conflict triggered weeks of sustained decline.', source:'News Orbiter', age:'3 days ago', pubDateMs:Date.now()-3*86400000, category:'macro', link:'https://www.newsorbiter.com/forex-reserves-fall-may-2026/'},
  ];
}

// ── Main export ──────────────────────────────────────────────
async function fetchForexNews() {
  var finnhubKey = process.env.FINNHUB_API_KEY;
  var rawItems = [];
  var source = 'curated';

  // Try Finnhub first if API key is available
  if (finnhubKey && finnhubKey !== 'none') {
    try {
      console.log('[News] Trying Finnhub...');
      rawItems = await fetchFinnhubNews(finnhubKey);
      if (rawItems.length > 0) source = 'finnhub';
      console.log('[News] Finnhub returned ' + rawItems.length + ' raw items');
    } catch(e) {
      console.warn('[News] Finnhub failed: ' + e.message);
    }
  }

  // Try Google News RSS if Finnhub didn't work or no key
  if (rawItems.length < 5) {
    try {
      console.log('[News] Trying Google News RSS...');
      var googleItems = await fetchGoogleNews();
      if (googleItems.length > 0) {
        rawItems = rawItems.concat(googleItems);
        source = rawItems.length > 5 ? 'google_news' : 'mixed';
      }
      console.log('[News] Google News returned ' + googleItems.length + ' raw items');
    } catch(e) {
      console.warn('[News] Google News failed: ' + e.message);
    }
  }

  // Process whatever we got
  if (rawItems.length >= 5) {
    var processed = processItems(rawItems);
    if (processed.length >= 4) {
      console.log('[News] ' + processed.length + ' items from ' + source);
      // Supplement with curated if few results
      if (processed.length < 8) {
        var curated = getCuratedNews().filter(function(c) {
          return !processed.some(function(p) { return p.text.slice(0,30) === c.text.slice(0,30); });
        });
        processed = processed.concat(curated).slice(0, 15);
      }
      return {success:true, source:source, items:processed, fetchedAt:new Date().toISOString()};
    }
  }

  // Full fallback to curated news
  console.log('[News] Using curated news (all live sources failed)');
  return {success:true, source:'curated', items:getCuratedNews(), fetchedAt:new Date().toISOString()};
}

module.exports = { fetchForexNews };
