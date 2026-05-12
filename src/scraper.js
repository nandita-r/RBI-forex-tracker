const axios = require('axios');
const cheerio = require('cheerio');

const RBI_WSS_URL = 'https://website.rbi.org.in/web/rbi/publications/weekly-statistical-supplement-extract';

// Known forward book data (RBI publishes this monthly with ~6 week lag)
// Update manually when RBI releases new data
const KNOWN_FORWARD_BOOK = {
  '2026-03': 103.0,
  '2026-02': 77.25,
  '2026-01': 68.42,
  '2025-12': 62.35,
};

// SDR + IMF tranche is relatively stable (~$18-20B), update quarterly
const SDR_IMF = 23.7;  // SDR $18.789B + IMF reserve tranche $4.863B

// Monthly imports (goods) in USD Bn - update quarterly from DGCI&S data
const MONTHLY_IMPORTS = 62.0;

function getLatestForwardBook() {
  const keys = Object.keys(KNOWN_FORWARD_BOOK).sort().reverse();
  return {
    value: KNOWN_FORWARD_BOOK[keys[0]],
    asOf: keys[0],
  };
}

async function fetchRBIReserves() {
  try {
    const { data: html } = await axios.get(RBI_WSS_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; RBITracker/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
      },
      timeout: 15000,
    });

    const $ = cheerio.load(html);
    const text = $('body').text();

    // RBI WSS table 2 contains: Total Reserves, FCA, Gold, SDRs, IMF
    // Pattern: "Total Reserves" followed by INR crore then USD Mn values
    // We look for USD Mn values in the table rows

    let totalReservesUSD = null;
    let goldUSD = null;
    let fcaUSD = null;
    let sdrUSD = null;
    let weekEnding = null;

    // Extract week ending date
    const dateMatch = text.match(/As on\s+([A-Za-z]+\.?\s+\d{1,2},?\s*\d{4})/i);
    if (dateMatch) {
      weekEnding = dateMatch[1].replace(/\./g, '').trim();
    }

    // Extract forex table rows - look for USD Mn columns
    // RBI format: rows of ₹Cr | US$Mn | ₹Cr | US$Mn | ...
    // Total Reserves row comes first, then FCA, Gold, SDRs, Reserve Tranche

    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (/total\s+reserves?/i.test(line)) {
        // Next few lines contain the numbers - find USD Mn (larger numbers after INR crore)
        const nums = extractNumbers(lines.slice(i, i + 5).join(' '));
        if (nums.length >= 2) {
          // USD Mn value is typically the 2nd number (after INR crore)
          totalReservesUSD = nums[1] / 1000; // convert Mn to Bn
        }
      }

      if (/foreign\s+currency\s+assets?/i.test(line) || /^1\.1\s/i.test(line)) {
        const nums = extractNumbers(lines.slice(i, i + 5).join(' '));
        if (nums.length >= 2) {
          fcaUSD = nums[1] / 1000;
        }
      }

      if (/^(1\.3|gold(\s+reserves?)?)\s/i.test(line) || /^\d+\s+gold/i.test(line)) {
        const nums = extractNumbers(lines.slice(i, i + 5).join(' '));
        if (nums.length >= 2) {
          goldUSD = nums[1] / 1000;
        }
      }

      if (/SDR|special drawing/i.test(line)) {
        const nums = extractNumbers(lines.slice(i, i + 5).join(' '));
        if (nums.length >= 2) {
          sdrUSD = nums[1] / 1000;
        }
      }
    }

    if (!totalReservesUSD) {
      throw new Error('Could not parse reserve data from RBI WSS page');
    }

    const fwdBook = getLatestForwardBook();
    const goldVal = goldUSD || 131.0;
    const sdrVal = sdrUSD || SDR_IMF;
    const usable = +(totalReservesUSD - goldVal - fwdBook.value - sdrVal).toFixed(1);

    return {
      success: true,
      source: 'rbi_wss_live',
      weekEnding: weekEnding || 'Latest',
      gross: +totalReservesUSD.toFixed(1),
      fca: fcaUSD ? +fcaUSD.toFixed(1) : null,
      gold: +goldVal.toFixed(1),
      forwardBook: fwdBook.value,
      forwardBookAsOf: fwdBook.asOf,
      sdr: +sdrVal.toFixed(1),
      usable,
      monthlyImports: MONTHLY_IMPORTS,
      grossImportCover: +(totalReservesUSD / MONTHLY_IMPORTS).toFixed(1),
      usableImportCover: +(usable / MONTHLY_IMPORTS).toFixed(1),
      fetchedAt: new Date().toISOString(),
    };

  } catch (err) {
    console.error('[Scraper] Error fetching RBI data:', err.message);
    // Return last known good data as fallback
    return getFallbackData(err.message);
  }
}

function extractNumbers(str) {
  const matches = str.match(/[\d,]+\.?\d*/g) || [];
  return matches
    .map(m => parseFloat(m.replace(/,/g, '')))
    .filter(n => !isNaN(n) && n > 0);
}

function getFallbackData(errorMsg) {
  const fwdBook = getLatestForwardBook();
  const gross = 690.7;
  const gold = 115.2;  // RBI WSS May 1 2026: gold $115.216B
  const sdr = 23.7;    // SDR $18.789B + IMF tranche $4.863B
  const usable = +(gross - gold - fwdBook.value - sdr).toFixed(1);
  return {
    success: false,
    source: 'fallback_cached',
    error: errorMsg,
    weekEnding: 'May 1, 2026',
    gross,
    fca: 559.7,
    gold,
    forwardBook: fwdBook.value,
    forwardBookAsOf: fwdBook.asOf,
    sdr,
    usable,
    monthlyImports: MONTHLY_IMPORTS,
    grossImportCover: +(gross / MONTHLY_IMPORTS).toFixed(1),
    usableImportCover: +(usable / MONTHLY_IMPORTS).toFixed(1),
    fetchedAt: new Date().toISOString(),
    note: 'Live scrape failed; showing last known data. RBI WSS may have changed format.',
  };
}

module.exports = { fetchRBIReserves, getLatestForwardBook };
