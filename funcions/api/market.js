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
const cleanSymbol = s => String(s || '').trim().toUpperCase().replace(/[^A-Z0-9.^=\-]/g, '').slice(0, 20);

async function yahoo(url, ttl) {
  const r = await fetch(url, { headers: UA, cf: { cacheTtl: ttl, cacheEverything: true } });
  if (r.status === 404) throw new Error('Symbol nicht gefunden – prüfe die Schreibweise (z. B. NESN.SW für Nestlé).');
  if (!r.ok) throw new Error('Datenquelle antwortet nicht (' + r.status + ')');
  return r.json();
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

export async function onRequestGet({ request }) {
  const u = new URL(request.url); const action = u.searchParams.get('action');
  try {
    if (action === 'chart') {
      const symbol = cleanSymbol(u.searchParams.get('symbol')); if (!symbol) return json({ ok: false, error: 'Kein Symbol' }, 400);
      const range = RANGES[u.searchParams.get('range')] ? u.searchParams.get('range') : '1mo';
      return json(Object.assign({ ok: true }, await chart(symbol, range)), 200, range === '1d' ? 60 : 600);
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
    return json({ ok: false, error: 'Unbekannte Aktion' }, 400);
  } catch (e) {
    return json({ ok: false, error: e.message || 'Fehler' }, 502, 0);
  }
}
