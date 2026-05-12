const axios = require('axios');

// ── Keyword scoring ──────────────────────────────────────────
const RELEVANCE = ['forex','foreign exchange','rupee','rbi','reserve bank','current account','fpi','fdi','dollar','usd','inr','crude oil','oil price','gold import','forward book','intervention','import cover','trade deficit','ndf','remittance','balance of payments','exchange rate','reserves','india currency','india economy'];
const POSITIVE  = ['reserves rise','reserves increase','reserves surge','rupee strengthens','rupee gains','rupee appreciates','inflows','fpi inflow','fdi inflow','rbi buys','current account surplus','trade surplus','remittances rise','exports grow','import restriction','rupee stable','reserves recover','dollar inflow','rupee jumps','rupee rebounds','rate cut','eases pressure'];
const NEGATIVE  = ['reserves fall','reserves drop','reserves decline','reserves plunge','reserves drain','rupee falls','rupee weakens','rupee depreciates','rupee slides','rupee record low','rupee hits low','outflows','fpi outflow','capital outflows','rbi sells dollar','trade deficit widens','oil prices rise','crude surges','brent rises','import bill rises','gold imports surge','forward book rises','forward book record','dollar demand','reserve depletion','rupee pressure','rate hike','tightening'];
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
  var ms=typeof ts==='number'?ts<9999999999?ts*1000:ts:new Date(ts).getTime();
  var diff=Date.now()-ms;
  var h=Math.floor(diff/3600000),days=Math.floor(diff/86400000);
  if(h<1)return 'Just now';if(h<24)return h+'h ago';if(days===1)return '1 day ago';if(days<7)return days+' days ago';return Math.floor(days/7)+' week(s) ago';
}
function trunc(s,max){var w=(s||'').replace(/<[^>]+>/g,'').trim().split(/\s+/);return w.length<=max?w.join(' '):w.slice(0,max).join(' ')+'...';}

// ── Finnhub fetcher ──────────────────────────────────────────
async function fetchFinnhubNews(apiKey) {
  // Fetch multiple categories and also search for India-specific news
  var now = Math.floor(Date.now()/1000);
  var weekAgo = now - 7*24*3600;

  var endpoints = [
    // General market news - latest 100 items
    'https://finnhub.io/api/v1/news?category=general&token=' + apiKey,
    // Forex news
    'https://finnhub.io/api/v1/news?category=forex&token=' + apiKey,
    // Crypto (sometimes covers macro/dollar)
    'https://finnhub.io/api/v1/news?category=crypto&token=' + apiKey,
  ];

  var allItems = [];
  for (var i = 0; i < endpoints.length; i++) {
    try {
      var res = await axios.get(endpoints[i], {
        timeout: 12000,
        headers: {'User-Agent':'RBIForexTracker/1.0', 'Accept':'application/json'}
      });
      if (Array.isArray(res.data)) {
        var items = res.data.map(function(item) {
          return {
            title: item.headline || '',
            summary: item.summary || '',
            pubDate: item.datetime || 0,
            pubDateMs: item.datetime ? item.datetime * 1000 : 0,
            source: item.source || 'Finnhub',
            link: item.url || '',
          };
        });
        console.log('[Finnhub] endpoint ' + (i+1) + ' returned ' + items.length + ' items');
        allItems = allItems.concat(items);
      }
    } catch(e) {
      console.warn('[Finnhub] endpoint ' + (i+1) + ' failed: ' + e.message);
    }
  }
  return allItems;
}

// ── Process raw items ────────────────────────────────────────
function processItems(rawItems) {
  // Filter relevant
  var relevant = rawItems.filter(function(item) {
    return isRelevant(item.title + ' ' + item.summary);
  });
  console.log('[News] ' + relevant.length + ' relevant out of ' + rawItems.length + ' total');

  // Score
  var scored = relevant.map(function(item) {
    var full = item.title + ' ' + item.summary;
    return {
      impact: scoreText(full),
      text: trunc(item.title, 25),
      source: item.source,
      age: item.pubDate ? timeAgo(item.pubDate) : 'Recently',
      pubDateMs: item.pubDateMs || 0,
      category: detectCat(full),
      link: item.link || '',
    };
  });

  // Sort newest first
  scored.sort(function(a,b){ return b.pubDateMs - a.pubDateMs; });

  // Deduplicate
  var seen = {};
  return scored.filter(function(item) {
    var key = item.text.slice(0,40).toLowerCase();
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  }).slice(0, 20);
}

// ── Curated fallback — updated May 12 2026 ──────────────────
function getCuratedNews() {
  var now = Date.now();
  var h = 3600000, d = 86400000;
  return [
    {impact:'neg', text:'PM Modi appeals to citizens to avoid buying gold and travelling abroad to protect forex reserves amid US-Iran conflict.', source:'The Week', age:'1 day ago', pubDateMs:now-d, category:'policy', link:'https://www.theweek.in/news/biz-tech/2026/05/11/rbi-sovereign-gold-strategy-vs-modi.html'},
    {impact:'neg', text:'Rupee depreciated 10.36% over past 12 months, trading near all-time lows around 94.43 per dollar, hit 95.33 on April 30.', source:'Whalesbook', age:'1 day ago', pubDateMs:now-d-h, category:'intervention', link:'https://www.whalesbook.com/news/English/economy/Indias-Rupee-Hits-All-Time-Lows-Forex-Reserves-Fall/6a012236707d23e84429c42d'},
    {impact:'neg', text:'India forex reserves fall $7.79B to $690.69B week ending May 1 as RBI sells dollars to defend rupee.', source:'Business Standard', age:'3 days ago', pubDateMs:now-3*d, category:'intervention', link:'https://www.business-standard.com/markets/news/india-s-forex-kitty-drops-by-7-79-billion-to-690-693-billion-rbi-126050801116_1.html'},
    {impact:'neg', text:'RBI gold reserves fall $5.02B to $115.2B in week ending May 1 amid valuation losses.', source:'RBI WSS', age:'3 days ago', pubDateMs:now-3*d-h, category:'macro', link:''},
    {impact:'neg', text:'FPI outflows from Indian equities reach $21B YTD 2026, sustained selling pressure on rupee.', source:'Whalesbook', age:'3 days ago', pubDateMs:now-3*d-2*h, category:'flows', link:'https://www.whalesbook.com/news/English/economy/RBIs-Rupee-Defense-Drains-Indias-Forex-Reserves/69fde43681f0ecc2dc73c1f0'},
    {impact:'neg', text:'US-Iran war driving oil above $105/barrel, widening India trade deficit and increasing dollar demand.', source:'Reuters', age:'2 days ago', pubDateMs:now-2*d, category:'geopolitical', link:''},
    {impact:'neg', text:'RBI net short forward book hits record $103B in March 2026, up $25.4B from February.', source:'Bloomberg', age:'12 days ago', pubDateMs:now-12*d, category:'intervention', link:'https://www.bloomberg.com/news/articles/2026-04-30/rbi-s-short-dollar-book-surges-past-100-billion-for-first-time'},
    {impact:'neg', text:'US Fed rate cuts delayed to second half of 2027, risking sustained capital outflows from emerging markets.', source:'Whalesbook', age:'1 day ago', pubDateMs:now-d-3*h, category:'macro', link:''},
    {impact:'neg', text:'Current account deficit risks exceeding 3% of GDP as oil above $105 widens trade gap.', source:'MUFG Research', age:'2 weeks ago', pubDateMs:now-14*d, category:'macro', link:''},
    {impact:'pos', text:'India sovereign gold holdings rise to 880 tonnes (16.7% of reserves), 680 tonnes now stored domestically.', source:'The Week', age:'1 day ago', pubDateMs:now-d-2*h, category:'macro', link:'https://www.theweek.in/news/biz-tech/2026/05/11/rbi-sovereign-gold-strategy-vs-modi.html'},
    {impact:'pos', text:'RBI caps bank net open positions at $100M, curbing speculative dollar demand and slowing reserve drain.', source:'RBI circular', age:'6 weeks ago', pubDateMs:now-42*d, category:'policy', link:''},
    {impact:'pos', text:'RBI bans INR NDF contracts for authorised dealers, closing offshore-onshore arbitrage channel.', source:'RBI notification', age:'6 weeks ago', pubDateMs:now-42*d-h, category:'policy', link:''},
    {impact:'neu', text:'RBI reserves peaked at $728.49B in late February before Middle East conflict triggered weeks of sustained decline.', source:'News Orbiter', age:'3 days ago', pubDateMs:now-3*d-3*h, category:'macro', link:'https://www.newsorbiter.com/forex-reserves-fall-may-2026/'},
    {impact:'neu', text:'RBI MPC member Ram Singh says India not facing external crisis despite reserve decline and rupee weakness.', source:'Whalesbook', age:'1 day ago', pubDateMs:now-d-4*h, category:'policy', link:''},
  ];
}

// ── Main export ──────────────────────────────────────────────
async function fetchForexNews() {
  var finnhubKey = process.env.FINNHUB_API_KEY;
  var rawItems = [];
  var source = 'curated';

  if (finnhubKey && finnhubKey !== 'none' && finnhubKey.length > 5) {
    try {
      console.log('[News] Fetching from Finnhub with key: ' + finnhubKey.substring(0,6) + '...');
      rawItems = await fetchFinnhubNews(finnhubKey);
      if (rawItems.length > 0) {
        var processed = processItems(rawItems);
        if (processed.length >= 3) {
          // Supplement with curated if Finnhub has few India-relevant items
          if (processed.length < 8) {
            console.log('[News] Supplementing ' + processed.length + ' Finnhub items with curated');
            var curated = getCuratedNews().filter(function(c) {
              return !processed.some(function(p){ return p.text.slice(0,30)===c.text.slice(0,30); });
            });
            processed = processed.concat(curated).slice(0, 15);
          }
          return {success:true, source:'finnhub', items:processed, fetchedAt:new Date().toISOString()};
        }
      }
      console.log('[News] Finnhub returned insufficient relevant items, using curated');
    } catch(e) {
      console.error('[News] Finnhub error: ' + e.message);
    }
  } else {
    console.log('[News] No Finnhub API key set');
  }

  return {success:true, source:'curated', items:getCuratedNews(), fetchedAt:new Date().toISOString()};
}

module.exports = { fetchForexNews };
