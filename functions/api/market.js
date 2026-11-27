// Cloudflare Pages Function – erreichbar unter /api/market
// Holt Kurse, Charts, Suche und Trends serverseitig (der Browser darf
// Finanz-APIs wegen CORS nicht direkt abfragen) und liefert kompaktes JSON.
//   ?action=chart&symbol=AAPL&range=1mo
//   ?action=search&q=nestle
//   ?action=trending

const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36', 'Accept': 'application/json' };
const RANGES = { '1d': '5m', '5d': '30m', '1mo': '1d', '6mo': '1d', '1y': '1d', '5y': '1wk' };
const json = (obj, status = 200, maxAge = 60) => new Response(JSON.stringify(obj), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': `public, max-age=${maxAge}` }
});
// Wichtige Werte je Kategorie für die Markt-Übersicht (max. ~20 pro Abruf wegen Cloudflare-Limit)
const UNIVERSE = {
  stocks: ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'AVGO', 'JPM', 'V', 'NESN.SW', 'NOVN.SW', 'ROG.SW', 'UBSG.SW', 'ZURN.SW', 'ABBN.SW', 'SAP.DE', 'ASML.AS', 'MC.PA'],
  etf: ['SPY', 'QQQ', 'VT', 'VTI', 'IWDA.AS', 'VWRL.AS', 'CSSPX.SW', 'CHSPI.SW', 'EEM', 'GLD', 'ARKK'],
  crypto: ['BTC-USD', 'ETH-USD', 'SOL-USD', 'XRP-USD', 'BNB-USD', 'DOGE-USD', 'ADA-USD'],
  index: ['^GSPC', '^NDX', '^DJI', '^SSMI', '^GDAXI', '^STOXX50E', '^N225', '^FTSE'],
  commodity: ['GC=F', 'SI=F', 'CL=F', 'NG=F', 'HG=F'],
  fx: ['USDCHF=X', 'EURCHF=X', 'EURUSD=X', 'GBPCHF=X', 'JPY=X']
};
const cleanSymbol = s => String(s || '').trim().toUpperCase().replace(/[^A-Z0-9.^=\-]/g, '').slice(0, 20);

// Yahoo hat zwei gleichwertige Server (query1 / query2). Fällt einer aus oder bremst
// (Fehler 429 „zu viele Anfragen“), wird automatisch der andere versucht.
// Wichtig: Nur ERFOLGREICHE Antworten werden bei Cloudflare zwischengespeichert –
// sonst bleibt ein kurzer Yahoo-Fehler bis zu 10 Minuten „hängen“.
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function yahoo(url, ttl) {
  const alt = url.includes('://query1.') ? url.replace('://query1.', '://query2.') : url.replace('://query2.', '://query1.');
  const tries = [url, alt, url];
  let last = null;
  for (let i = 0; i < tries.length; i++) {
    if (i) await sleep(400 * i);
    let r;
    try {
      r = await fetch(tries[i], { headers: UA, cf: { cacheTtlByStatus: { '200-299': ttl, '404': 60, '400-599': 0 }, cacheEverything: true } });
    } catch (e) { last = 'Netzwerkfehler'; continue; }
    if (r.status === 404) throw new Error('Symbol nicht gefunden – prüfe die Schreibweise (z. B. NESN.SW für Nestlé).');
    if (r.ok) {
      try { return await r.json(); } catch (e) { last = 'ungültige Antwort'; continue; }
    }
    last = r.status;
  }
  throw new Error(last === 429 ? 'Die Börsen-Datenquelle (Yahoo) bremst gerade zu viele Anfragen (429). Bitte in 1–2 Minuten nochmal versuchen.' : 'Datenquelle antwortet nicht (' + last + ')');
}
async function chart(symbol, range) {
  const interval = RANGES[range] || '1d';
  const j = await yahoo(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false`, range === '1d' ? 60 : 600);
  const res = j && j.chart && j.chart.result && j.chart.result[0];
  if (!res) throw new Error((j && j.chart && j.chart.error && j.chart.error.description) || 'Symbol nicht gefunden');
  const m = res.meta || {};
  const closes = (((res.indicators || {}).quote || [])[0] || {}).close || [];
  const points = (res.timestamp || []).map((t, i) => [t * 1000, closes[i]]).filter(p => typeof p[1] === 'number');
  const price = m.regularMarketPrice ?? (points.length ? points[points.length - 1][1] : null);
  const prevClose = m.chartPreviousClose ?? m.previousClose ?? null;
  return {
    symbol: m.symbol || symbol, name: m.longName || m.shortName || symbol, currency: m.currency || '',
    exchange: m.fullExchangeName || m.exchangeName || '', type: m.instrumentType || '',
    price, prevClose, dayChangePct: price != null && m.previousClose ? (price - m.previousClose) / m.previousClose * 100 : null,
    marketTime: (m.regularMarketTime || 0) * 1000, range, points
  };
}

// Kerzen (Eröffnung, Hoch, Tief, Schluss, Volumen) für den Live-Trader
const CANDLE_TF = {
  '15m': ['15m', '10d'], '1h': ['60m', '60d'], '4h': ['60m', '6mo', 4],
  '1d': ['1d', '2y'], '1w': ['1wk', '10y'], '1M': ['1mo', 'max'], '1y': ['1mo', 'max', 'year']
};
async function candles(symbol, tf) {
  const [interval, range, group] = CANDLE_TF[tf];
  const intraday = ['15m', '1h', '4h'].includes(tf);
  const j = await yahoo(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false`, intraday ? 60 : 600);
  const res = j && j.chart && j.chart.result && j.chart.result[0];
  if (!res) throw new Error((j && j.chart && j.chart.error && j.chart.error.description) || 'Symbol nicht gefunden');
  const m = res.meta || {}, q = (((res.indicators || {}).quote || [])[0]) || {};
  let rows = (res.timestamp || []).map((t, i) => [t, q.open && q.open[i], q.high && q.high[i], q.low && q.low[i], q.close && q.close[i], (q.volume && q.volume[i]) || 0])
    .filter(r => [1, 2, 3, 4].every(k => typeof r[k] === 'number'));
  if (group) {
    const key = group === 'year' ? t => Date.UTC(new Date(t * 1000).getUTCFullYear(), 0, 1) / 1000 : t => Math.floor(t / (3600 * group)) * 3600 * group;
    const out = [];
    for (const r of rows) {
      const k = key(r[0]), a = out[out.length - 1];
      if (a && a[0] === k) { a[2] = Math.max(a[2], r[2]); a[3] = Math.min(a[3], r[3]); a[4] = r[4]; a[5] += r[5]; }
      else out.push([k, r[1], r[2], r[3], r[4], r[5]]);
    }
    rows = out;
  }
  const clean = [];
  for (const r of rows) { if (!clean.length || r[0] > clean[clean.length - 1][0]) clean.push(r); else clean[clean.length - 1] = r; }
  return {
    symbol: m.symbol || symbol, name: m.longName || m.shortName || symbol, currency: m.currency || '',
    exchange: m.fullExchangeName || m.exchangeName || '', type: m.instrumentType || '', tf,
    price: m.regularMarketPrice ?? (clean.length ? clean[clean.length - 1][4] : null), candles: clean.slice(-500)
  };
}

export async function onRequestGet({ request }) {
  const u = new URL(request.url); const action = u.searchParams.get('action');
  try {
    if (action === 'chart') {
      const symbol = cleanSymbol(u.searchParams.get('symbol')); if (!symbol) return json({ ok: false, error: 'Kein Symbol' }, 400);
      const range = RANGES[u.searchParams.get('range')] ? u.searchParams.get('range') : '1mo';
      return json(Object.assign({ ok: true }, await chart(symbol, range)), 200, range === '1d' ? 60 : 600);
    }
    if (action === 'candles') {
      const symbol = cleanSymbol(u.searchParams.get('symbol')); if (!symbol) return json({ ok: false, error: 'Kein Symbol' }, 400);
      const tf = CANDLE_TF[u.searchParams.get('tf')] ? u.searchParams.get('tf') : '1d';
      return json(Object.assign({ ok: true }, await candles(symbol, tf)), 200, ['15m', '1h', '4h'].includes(tf) ? 30 : 300);
    }
    if (action === 'search') {
      const q = String(u.searchParams.get('q') || '').trim().slice(0, 50); if (!q) return json({ ok: true, results: [] });
      const j = await yahoo(`https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0&lang=de-CH`, 3600);
      const results = (j.quotes || []).filter(x => x.symbol).map(x => ({ symbol: x.symbol, name: x.longname || x.shortname || x.symbol, type: x.quoteType || '', exchange: x.exchDisp || '' }));
      return json({ ok: true, results }, 200, 3600);
    }
    if (action === 'trending') {
      const j = await yahoo('https://query1.finance.yahoo.com/v1/finance/trending/US?count=12', 600);
      const syms = ((((j.finance || {}).result || [])[0] || {}).quotes || []).map(x => x.symbol).filter(Boolean).slice(0, 10);
      const items = (await Promise.allSettled(syms.map(s => chart(s, '1d')))).filter(r => r.status === 'fulfilled').map(r => {
        const c = r.value; return { symbol: c.symbol, name: c.name, price: c.price, currency: c.currency, dayChangePct: c.dayChangePct };
      });
      return json({ ok: true, items }, 200, 600);
    }
    if (action === 'overview') {
      const cat = u.searchParams.get('cat'); const list = UNIVERSE[cat];
      if (!list) return json({ ok: false, error: 'Unbekannte Kategorie' }, 400);
      const items = (await Promise.allSettled(list.map(s => chart(s, '1d')))).filter(r => r.status === 'fulfilled').map(r => {
        const c = r.value; return { symbol: c.symbol, name: c.name, price: c.price, currency: c.currency, dayChangePct: c.dayChangePct, cat };
      });
      return json({ ok: true, cat, items }, 200, 120);
    }
    if (action === 'movers') {
      const id = ['day_gainers', 'day_losers', 'most_actives'].includes(u.searchParams.get('type')) ? u.searchParams.get('type') : 'day_gainers';
      const j = await yahoo(`https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=${id}&count=15`, 300);
      const quotes = ((((j.finance || {}).result || [])[0] || {}).quotes || []);
      const items = quotes.map(q => ({ symbol: q.symbol, name: q.shortName || q.longName || q.symbol, price: q.regularMarketPrice, currency: q.currency || '', dayChangePct: q.regularMarketChangePercent, type: q.quoteType || '' })).filter(x => x.symbol);
      return json({ ok: true, type: id, items }, 200, 300);
    }
    return json({ ok: false, error: 'Unbekannte Aktion' }, 400);
  } catch (e) {
    return json({ ok: false, error: e.message || 'Fehler' }, 502, 0);
  }
}
