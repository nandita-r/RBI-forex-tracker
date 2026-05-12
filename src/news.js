const axios = require('axios');

// ── Keyword scoring ──────────────────────────────────────────
const RELEVANCE = ['forex','foreign exchange','rupee','rbi','reserve bank','current account','fpi','fdi','dollar','usd','inr','crude oil','oil price','gold import','forward book','intervention','import cover','trade deficit','ndf','remittance','balance of payments','exchange rate','forex kitty','reserves'];
const POSITIVE  = ['reserves rise','reserves increase','reserves surge','rupee strengthens','rupee gains','rupee appreciates','inflows','fpi inflow','fdi inflow','rbi buys','current account surplus','trade surplus','remittances rise','exports grow','import restriction','rupee stable','reserves recover','dollar inflow'];
const NEGATIVE  = ['reserves fall','reserves drop','reserves decline','reserves plunge','reserves drain','rupee falls','rupee weakens','rupee depreciates','rupee slides','rupee record low','outflows','fpi outflow','capital outflows','rbi sells dollar','trade deficit widens','oil prices rise','crude surges','brent rises','import bill rises','gold imports surge','forward book rises','forward book record','dollar demand','reserve depletion'];
const CATS = {
  intervention: ['intervention','rbi sells','rbi buys','forward book','ndf','open position'],
  policy:       ['rbi policy','repo rate','monetary policy','rbi circular','rbi governor','rbi notification'],
  flows:        ['fpi','fdi','fii','capital flows','inflows','outflows','remittance'],
  trade:        ['trade deficit','current account','exports','imports','import bill'],
  geopolitical: ['iran','middle east','war','sanctions','strait','conflict','opec'],
  macro:        ['gdp','inflation','cpi','repo rate','fed','federal reserve','dollar index'],
};

function isRelevant(t) { var l=t.toLowerCase(); return RELEVANCE.some(function(k){return l.includes(k);}); }
function score(t) {
  var l=t.toLowerCase();
  var p=POSITIVE.filter(function(k){return l.includes(k);}).length;
  var n=NEGATIVE.filter(function(k){return l.includes(k);}).length;
  return p>n?'pos':n>p?'neg':'neu';
}
function category(t) {
  var l=t.toLowerCase();
  for (var cat in CATS) { if (CATS[cat].some(function(k){return l.includes(k);})) return cat; }
  return 'macro';
}
function timeAgo(ts) {
  var diff=Date.now()-new Date(ts*1000||ts).getTime();
  var h=Math.floor(diff/3600000),d=Math.floor(diff/86400000);
  if(h<1)return 'Just now';if(h<24)return h+'h ago';if(d===1)return '1 day ago';if(d<7)return d+' days ago';return Math.floor(d/7)+' week(s) ago';
}
function trunc(s,max){var w=(s||'').replace(/<[^>]+>/g,'').trim().split(/\s+/);return w.length<=max?w.join(' '):w.slice(0,max).join(' ')+'...';}

// ── Finnhub news fetcher ─────────────────────────────────────
async function fetchFinnhubNews(apiKey) {
  // Finnhub general market news — category 'general' includes macro/forex
  // Also fetch forex-specific news
  const endpoints = [
    'https://finnhub.io/api/v1/news?category=general&minId=0&token=' + apiKey,
    'https://finnhub.io/api/v1/news?category=forex&minId=0&token=' + apiKey,
  ];
  var allItems = [];
  for (var i=0; i<endpoints.length; i++) {
    try {
      var res = await axios.get(endpoints[i], {timeout:10000, headers:{'User-Agent':'RBITracker/1.0'}});
      if (Array.isArray(res.data)) {
        allItems = allItems.concat(res.data.map(function(item){
          return {
            title: item.headline || '',
            summary: item.summary || '',
            pubDate: item.datetime,
            source: item.source || 'Finnhub',
            link: item.url || '',
          };
        }));
      }
    } catch(e) { console.warn('[Finnhub] endpoint failed:', e.message); }
  }
  return allItems;
}

// ── Fallback: curated static news ───────────────────────────
function getStaticNews() {
  return [
    {impact:'neg',text:'RBI forex reserves fall $7.79B in week ending May 1 as dollar selling defends rupee.',source:'RBI WSS',age:'3 days ago',category:'intervention'},
    {impact:'neg',text:'Brent crude above $105/barrel widens India oil import bill and current account deficit.',source:'Reuters',age:'1 day ago',category:'trade'},
    {impact:'neg',text:'FPI outflows from Indian equities reach $21B YTD 2026, sustained rupee selling pressure.',source:'SEBI',age:'2 days ago',category:'flows'},
    {impact:'pos',text:'RBI caps bank net open positions at $100M each, curbing speculative dollar demand.',source:'RBI circular',age:'6 weeks ago',category:'policy'},
    {impact:'pos',text:'RBI bans INR NDF contracts for authorised dealers, closing offshore arbitrage channel.',source:'RBI notification',age:'6 weeks ago',category:'policy'},
    {impact:'neg',text:'RBI net short forward book hits record $103B in March - future dollar obligations mount.',source:'Bloomberg',age:'2 weeks ago',category:'intervention'},
    {impact:'pos',text:'PM Modi appeals for reduced gold imports and foreign travel to conserve dollar reserves.',source:'PTI',age:'1 day ago',category:'policy'},
    {impact:'neg',text:'USD/INR approaches 95 level; RBI must sell dollars to prevent disorderly depreciation.',source:'FX Leaders',age:'1 day ago',category:'intervention'},
    {impact:'pos',text:'RBI holds repo rate at 5.25%, maintains stability focus amid global uncertainty.',source:'DD News',age:'1 week ago',category:'macro'},
    {impact:'neg',text:'Current account deficit risks exceeding 3% of GDP as oil above $105 widens trade gap.',source:'MUFG Research',age:'4 days ago',category:'macro'},
    {impact:'neg',text:'Iran-US tensions keep Strait of Hormuz risk elevated; freight and insurance costs rising.',source:'Reuters',age:'2 days ago',category:'geopolitical'},
    {impact:'pos',text:'India sovereign gold holdings rise to 880 tonnes (16.7% of reserves) - strategic hedge.',source:'The Week',age:'1 day ago',category:'macro'},
  ];
}

// ── Main export ──────────────────────────────────────────────
async function fetchForexNews() {
  var apiKey = process.env.FINNHUB_API_KEY;

  if (!apiKey || apiKey === 'none') {
    console.log('[News] No Finnhub API key - using static news');
    return { success: false, source: 'static', items: getStaticNews(), fetchedAt: new Date().toISOString() };
  }

  try {
    console.log('[News] Fetching from Finnhub...');
    var rawItems = await fetchFinnhubNews(apiKey);

    // Filter to forex/India relevant items
    var relevant = rawItems.filter(function(item){ return isRelevant(item.title+' '+item.summary); });

    // Score and format
    var scored = relevant.map(function(item){
      var full = item.title+' '+item.summary;
      return {
        impact: score(full),
        text: trunc(item.title, 25),
        source: item.source,
        age: timeAgo(item.pubDate),
        pubDateMs: item.pubDate ? new Date(item.pubDate*1000||item.pubDate).getTime() : 0,
        category: category(full),
        link: item.link,
      };
    });

    // Sort: neg first, then pos, then neu; deduplicate
    var sorted = scored.filter(function(i){return i.impact==='neg';})
      .concat(scored.filter(function(i){return i.impact==='pos';}))
      .concat(scored.filter(function(i){return i.impact==='neu';}));

    var seen = {};
    var deduped = sorted.filter(function(item){
      var key = item.text.slice(0,40).toLowerCase();
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    }).slice(0, 20);

    // If Finnhub returned nothing relevant, supplement with static
    if (deduped.length < 4) {
      console.log('[News] Finnhub returned few relevant items - supplementing with static');
      deduped = deduped.concat(getStaticNews()).slice(0, 15);
    }

    console.log('[News] ' + deduped.length + ' items returned');
    return { success: true, source: 'finnhub', items: deduped, fetchedAt: new Date().toISOString() };

  } catch(err) {
    console.error('[News] Finnhub fetch failed:', err.message);
    return { success: false, source: 'static_fallback', items: getStaticNews(), fetchedAt: new Date().toISOString() };
  }
}

module.exports = { fetchForexNews };
