const axios = require('axios');

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';

const NEWS_SYSTEM_PROMPT = `You are a senior macro analyst specialising in India's external sector and RBI policy. 
Return ONLY a valid JSON array — no markdown, no backticks, no commentary.
Each item in the array must have exactly these fields:
  impact: "pos" | "neg" | "neu"
  text: string (max 25 words, factual, present-tense)
  source: string (publication/source name)
  age: string (e.g. "1 day ago", "3 days ago", "1 week ago")
  category: "intervention" | "policy" | "flows" | "trade" | "geopolitical" | "macro"

Impact definitions:
  pos = directly helps or will help India's forex kitty (reserve accretion, reduced outflows, inflows)
  neg = directly drains or will drain forex kitty (reserve depletion, capital outflows, higher import bill)
  neu = relevant to watch but net impact unclear or offsetting

Focus only on events from the past 2 weeks. Include 12-15 items covering:
- RBI spot/forward market interventions
- Capital flow measures (NOP caps, NDF rules)
- FPI/FDI flows
- Oil price movements and their import bill impact
- Gold import policies
- Current account / trade data
- Any GOI measures affecting capital flows or import demand
- RBI forward book developments`;

async function fetchForexNews(apiKey) {
  const key = apiKey || process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return getStaticNews();
  }

  try {
    const response = await axios.post(ANTHROPIC_API, {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1200,
      system: NEWS_SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `Today is ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}. 
Generate the latest 12-15 news items about RBI and GOI actions affecting India's forex reserves. 
Use real, factual events you know about. Be specific with numbers where available.`
      }]
    }, {
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      timeout: 30000,
    });

    const raw = response.data.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');

    const clean = raw.replace(/```json|```/g, '').trim();
    const items = JSON.parse(clean);

    return {
      success: true,
      items,
      fetchedAt: new Date().toISOString(),
    };
  } catch (err) {
    console.error('[News] Error fetching AI news:', err.message);
    return getStaticNews();
  }
}

function getStaticNews() {
  return {
    success: false,
    source: 'static_cache',
    fetchedAt: new Date().toISOString(),
    items: [
      { impact: 'neg', text: 'RBI forex reserves fall $7.79B in week ending May 1 as dollar selling defends rupee.', source: 'RBI WSS', age: '3 days ago', category: 'intervention' },
      { impact: 'neg', text: 'Brent crude above $105/barrel; India oil import bill widens current account deficit materially.', source: 'Reuters', age: '1 day ago', category: 'trade' },
      { impact: 'neg', text: 'FPI outflows from Indian equities reach $21B YTD 2026, sustained selling pressure on rupee.', source: 'SEBI', age: '2 days ago', category: 'flows' },
      { impact: 'pos', text: 'RBI caps bank net open positions at $100M each, curbing speculative dollar demand effectively.', source: 'RBI circular', age: '6 weeks ago', category: 'policy' },
      { impact: 'pos', text: 'RBI bans INR NDF contracts for authorised dealers, closing offshore-onshore arbitrage channel.', source: 'RBI notification', age: '6 weeks ago', category: 'policy' },
      { impact: 'neg', text: 'RBI net short forward book hits record $103B in March — future dollar delivery obligations mount.', source: 'Bloomberg', age: '2 weeks ago', category: 'intervention' },
      { impact: 'pos', text: 'PM Modi appeals for reduced gold imports and foreign travel to conserve dollar reserves.', source: 'PTI', age: '1 day ago', category: 'policy' },
      { impact: 'neg', text: 'USD/INR approaches 95 level; RBI must sell dollars to prevent disorderly depreciation spiral.', source: 'FX Leaders', age: '1 day ago', category: 'intervention' },
      { impact: 'pos', text: 'RBI holds repo rate at 5.25%, maintains stability focus; no emergency rate hike signalled.', source: 'DD News', age: '1 week ago', category: 'macro' },
      { impact: 'neg', text: 'Current account deficit risks exceeding 3% of GDP as oil above $105 widens trade gap.', source: 'MUFG Research', age: '4 days ago', category: 'macro' },
      { impact: 'neg', text: 'Iran-US tensions keep Strait of Hormuz risk elevated; freight and insurance costs rising.', source: 'Reuters', age: '2 days ago', category: 'geopolitical' },
      { impact: 'pos', text: 'India sovereign gold holdings rise to 880 tonnes (16.7% of reserves) — strategic dollar hedge.', source: 'The Week', age: '1 day ago', category: 'macro' },
    ],
  };
}

module.exports = { fetchForexNews };
