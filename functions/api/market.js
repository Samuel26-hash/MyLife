// Cloudflare Pages Function – erreichbar unter /api/market   (V15.8 – neu aufgebaut)
// Holt Kurse, Charts, Suche und Trends serverseitig (der Browser darf
// Finanz-APIs wegen CORS nicht direkt abfragen) und liefert kompaktes JSON.
//   ?action=chart&symbol=AAPL&range=1mo
//   ?action=candles&symbol=BTC-USD&tf=1d
//   ?action=search&q=nestle
//   ?action=trending | overview&cat=stocks | movers&type=day_gainers
//   ?action=diag                       → zeigt, welche Datenquelle gerade funktioniert
//
// Datenquellen (der Reihe nach, die erste die klappt gewinnt):
//   1. Yahoo Finance – seit 2026 nur noch mit „Sitzungs-Ausweis“ (Cookie + Crumb).
//      Ohne den antwortet Yahoo Servern (z. B. Cloudflare) mit Fehler 429.
//   2. Krypto: Binance (data-api.binance.vision) und Coinbase – ohne Schlüssel.
//   3. Alles andere: Twelve Data, falls in Cloudflare das Secret TWELVE_KEY hinterlegt ist.

const UA_STR = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const UA = { 'User-Agent': UA_STR, 'Accept': 'application/json,text/plain,*/*', 'Accept-Language': 'de-CH,de;q=0.9,en;q=0.8' };
const RANGES = { '1d': '5m', '5d': '30m', '1mo': '1d', '6mo': '1d', '1y': '1d', '5y': '1wk' };
const json = (obj, status = 200, maxAge = 60) => new Response(JSON.stringify(obj), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': `public, max-age=${maxAge}` }
});
// Wichtige Werte je Kategorie für die Markt-Übersicht
const UNIVERSE = {
  stocks: ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'AVGO', 'JPM', 'V', 'NESN.SW', 'NOVN.SW', 'ROG.SW', 'UBSG.SW', 'ZURN.SW', 'ABBN.SW', 'SAP.DE', 'ASML.AS', 'MC.PA'],
  etf: ['SPY', 'QQQ', 'VT', 'VTI', 'IWDA.AS', 'VWRL.AS', 'CSSPX.SW', 'CHSPI.SW', 'EEM', 'GLD', 'ARKK'],
  crypto: ['BTC-USD', 'ETH-USD', 'SOL-USD', 'XRP-USD', 'BNB-USD', 'DOGE-USD', 'ADA-USD'],
  index: ['^GSPC', '^NDX', '^DJI', '^SSMI', '^GDAXI', '^STOXX50E', '^N225', '^FTSE'],
  commodity: ['GC=F', 'SI=F', 'CL=F', 'NG=F', 'HG=F'],
  fx: ['USDCHF=X', 'EURCHF=X', 'EURUSD=X', 'GBPCHF=X', 'JPY=X']
};
const CRYPTO_NAMES = { BTC: 'Bitcoin', ETH: 'Ethereum', SOL: 'Solana', XRP: 'XRP', BNB: 'BNB', DOGE: 'Dogecoin', ADA: 'Cardano' };
const cleanSymbol = s => String(s || '').trim().toUpperCase().replace(/[^A-Z0-9.^=\-]/g, '').slice(0, 20);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const isCrypto = s => /^[A-Z0-9]{2,10}-(USD|USDT|EUR|CHF)$/.test(s);
class NotFound extends Error { }

// =====================================================================
//  1. YAHOO mit Sitzungs-Ausweis (Cookie + Crumb)
// =====================================================================
let Y = { cookie: '', crumb: '', at: 0, err: '' };
function cookiesOf(r) {
  let list = [];
  try { if (typeof r.headers.getSetCookie === 'function') list = r.headers.getSetCookie(); } catch (e) { }
  if (!list.length) { try { if (typeof r.headers.getAll === 'function') list = r.headers.getAll('Set-Cookie'); } catch (e) { } }
  if (!list.length) { const one = r.headers.get('set-cookie'); if (one) list = one.split(/,(?=\s*[A-Za-z0-9_]+=)/); }
  return list.map(s => s.split(';')[0].trim()).filter(s => s && s.includes('='));
}
async function yAuth(force) {
  if (!force && Y.crumb && Date.now() - Y.at < 45 * 60000) return Y;
  if (!force && !Y.crumb && Y.at && Date.now() - Y.at < 60000) return Y;   // nicht jede Sekunde neu versuchen
  let jar = [];
  for (const u of ['https://fc.yahoo.com/', 'https://finance.yahoo.com/quote/AAPL/', 'https://login.yahoo.com/']) {
    try {
      const r = await fetch(u, { headers: { 'User-Agent': UA_STR, 'Accept': 'text/html,*/*' }, redirect: 'manual' });
      jar = jar.concat(cookiesOf(r));
      if (jar.some(c => /^A3=|^A1=/.test(c))) break;
    } catch (e) { }
  }
  const cookie = [...new Map(jar.map(c => [c.split('=')[0], c])).values()].join('; ');
  let crumb = '', err = '';
  for (const h of ['query1', 'query2']) {
    try {
      const r = await fetch(`https://${h}.finance.yahoo.com/v1/test/getcrumb`, { headers: Object.assign({}, UA, { 'Accept': 'text/plain', Cookie: cookie }) });
      const t = (await r.text()).trim();
      if (r.ok && t && t.length < 40 && !/[<{\s]/.test(t)) { crumb = t; break; }
      err = 'Crumb ' + r.status;
    } catch (e) { err = 'Crumb: ' + e.message; }
  }
  Y = { cookie, crumb, at: Date.now(), err };
  return Y;
}
async function yFetch(url, ttl, withAuth) {
  const h = Object.assign({}, UA);
  let u = url;
  if (withAuth) {
    const a = await yAuth(withAuth === 'force');
    if (a.cookie) h.Cookie = a.cookie;
    if (a.crumb) u += (u.includes('?') ? '&' : '?') + 'crumb=' + encodeURIComponent(a.crumb);
  }
  return fetch(u, { headers: h, cf: withAuth ? { cacheTtl: 0 } : { cacheTtlByStatus: { '200-299': ttl, '400-599': 0 }, cacheEverything: true } });
}
let yDownUntil = 0;   // Yahoo hat eben komplett blockiert → kurz überspringen (spart Anfragen)
async function yahoo(url, ttl) {
  if (Date.now() < yDownUntil) throw new Error('Yahoo blockiert gerade (429)');
  const alt = url.includes('://query1.') ? url.replace('://query1.', '://query2.') : url.replace('://query2.', '://query1.');
  // ohne Ausweis (schnell, zwischengespeichert) → mit Ausweis → anderer Server mit Ausweis → neuer Ausweis
  const plan = [[url, false], [url, true], [alt, true], [alt, 'force']];
  let last = null;
  for (let i = 0; i < plan.length; i++) {
    if (i > 1) await sleep(300 * i);
    let r;
    try { r = await yFetch(plan[i][0], ttl, plan[i][1]); } catch (e) { last = 'Netzwerkfehler'; continue; }
    if (r.status === 404) throw new NotFound('Symbol nicht gefunden – prüfe die Schreibweise (z. B. NESN.SW für Nestlé).');
    if (r.ok) { try { return await r.json(); } catch (e) { last = 'ungültige Antwort'; continue; } }
    last = r.status;
  }
  if (last === 429 || last === 401 || last === 403) yDownUntil = Date.now() + 60000;
  throw new Error(last === 429 ? 'Yahoo blockiert gerade (429)' : 'Yahoo antwortet nicht (' + last + ')');
}

// =====================================================================
//  2. KRYPTO ohne Yahoo: Binance → Coinbase
// =====================================================================
const BIN_TF = { '15m': ['15m'], '1h': ['1h'], '4h': ['4h'], '1d': ['1d'], '1w': ['1w'], '1M': ['1M'], '1y': ['1M', 'year'] };
async function binanceCandles(symbol, tf) {
  const base = symbol.split('-')[0], quote = symbol.split('-')[1] === 'EUR' ? 'EUR' : 'USDT';
  const [iv, group] = BIN_TF[tf] || ['1d'];
  let last = '';
  for (const host of ['https://data-api.binance.vision', 'https://api.binance.com', 'https://api1.binance.com']) {
    try {
      const r = await fetch(`${host}/api/v3/klines?symbol=${base}${quote}&interval=${iv}&limit=1000`, { headers: UA, cf: { cacheTtlByStatus: { '200-299': 30, '400-599': 0 } } });
      if (r.status === 400) throw new NotFound('Krypto-Paar bei Binance unbekannt');
      if (!r.ok) { last = 'Binance ' + r.status; continue; }
      const a = await r.json();
      let rows = a.map(k => [Math.floor(k[0] / 1000), +k[1], +k[2], +k[3], +k[4], +k[5]]);
      if (group) rows = groupYear(rows);
      return { rows, name: (CRYPTO_NAMES[base] || base) + ' (' + base + ')', currency: quote === 'EUR' ? 'EUR' : 'USD', exchange: 'Binance', type: 'CRYPTOCURRENCY', source: 'Binance' };
    } catch (e) { if (e instanceof NotFound) throw e; last = 'Binance: ' + e.message; }
  }
  throw new Error(last || 'Binance nicht erreichbar');
}
const CB_TF = { '15m': [900], '1h': [3600], '4h': [3600, 4], '1d': [86400], '1w': [86400, 7], '1M': [86400, 'month'], '1y': [86400, 'year'] };
async function coinbaseCandles(symbol, tf) {
  const base = symbol.split('-')[0], quote = symbol.split('-')[1] === 'USDT' ? 'USD' : symbol.split('-')[1];
  const [gran, group] = CB_TF[tf] || [86400];
  const r = await fetch(`https://api.exchange.coinbase.com/products/${base}-${quote}/candles?granularity=${gran}`, { headers: UA });
  if (r.status === 404) throw new NotFound('Krypto-Paar bei Coinbase unbekannt');
  if (!r.ok) throw new Error('Coinbase ' + r.status);
  let rows = (await r.json()).map(k => [k[0], +k[3], +k[2], +k[1], +k[4], +k[5]]).sort((a, b) => a[0] - b[0]);
  if (group === 'year') rows = groupYear(rows);
  else if (group === 'month') rows = groupBy(rows, t => { const d = new Date(t * 1000); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000; });
  else if (group) rows = groupBy(rows, t => Math.floor(t / (gran * group)) * gran * group);
  return { rows, name: (CRYPTO_NAMES[base] || base) + ' (' + base + ')', currency: quote, exchange: 'Coinbase', type: 'CRYPTOCURRENCY', source: 'Coinbase' };
}

// =====================================================================
//  3. TWELVE DATA (nur wenn TWELVE_KEY in Cloudflare hinterlegt ist)
// =====================================================================
const TD_TF = { '15m': ['15min'], '1h': ['1h'], '4h': ['4h'], '1d': ['1day'], '1w': ['1week'], '1M': ['1month'], '1y': ['1month', 'year'] };
const TD_SPECIAL = { '^GSPC': 'SPX', '^NDX': 'NDX', '^DJI': 'DJI', '^GDAXI': 'DAX', '^FTSE': 'UKX', '^N225': 'N225', '^SSMI': 'SMI', '^STOXX50E': 'SX5E', 'GC=F': 'XAU/USD', 'SI=F': 'XAG/USD', 'CL=F': 'WTI/USD', 'NG=F': 'NG/USD', 'HG=F': 'XCU/USD', 'JPY=X': 'USD/JPY' };
const TD_EX = { SW: 'SIX', DE: 'XETR', AS: 'Euronext', PA: 'Euronext', L: 'LSE', MI: 'MTA', TO: 'TSX' };
function tdSymbol(s) {
  if (TD_SPECIAL[s]) return { symbol: TD_SPECIAL[s] };
  let m;
  if ((m = s.match(/^([A-Z]{3})([A-Z]{3})=X$/))) return { symbol: m[1] + '/' + m[2] };
  if ((m = s.match(/^([A-Z0-9]+)-(USD|EUR|CHF)$/))) return { symbol: m[1] + '/' + m[2] };
  if ((m = s.match(/^(.+)\.([A-Z]{1,3})$/)) && TD_EX[m[2]]) return { symbol: m[1], exchange: TD_EX[m[2]] };
  return { symbol: s };
}
async function twelveCandles(symbol, tf, env) {
  if (!env || !env.TWELVE_KEY) throw new Error('Twelve Data: kein TWELVE_KEY hinterlegt');
  const [iv, group] = TD_TF[tf] || ['1day'], t = tdSymbol(symbol);
  const q = new URLSearchParams({ symbol: t.symbol, interval: iv, outputsize: '500', apikey: env.TWELVE_KEY });
  if (t.exchange) q.set('exchange', t.exchange);
  const r = await fetch('https://api.twelvedata.com/time_series?' + q, { cf: { cacheTtlByStatus: { '200-299': 60, '400-599': 0 } } });
  const j = await r.json().catch(() => ({}));
  if (j.status === 'error' || !Array.isArray(j.values)) throw new Error('Twelve Data: ' + (j.message || r.status));
  let rows = j.values.map(v => [Math.floor(Date.parse(v.datetime.length <= 10 ? v.datetime + 'T00:00:00Z' : v.datetime.replace(' ', 'T') + 'Z') / 1000), +v.open, +v.high, +v.low, +v.close, +(v.volume || 0)]).sort((a, b) => a[0] - b[0]);
  if (group) rows = groupYear(rows);
  const m = j.meta || {};
  return { rows, name: m.symbol || symbol, currency: m.currency || m.currency_quote || '', exchange: m.exchange || '', type: m.type || '', source: 'Twelve Data' };
}

// ---------- Hilfen ----------
function groupBy(rows, key) {
  const out = [];
  for (const r of rows) {
    const k = key(r[0]), a = out[out.length - 1];
    if (a && a[0] === k) { a[2] = Math.max(a[2], r[2]); a[3] = Math.min(a[3], r[3]); a[4] = r[4]; a[5] += r[5]; }
    else out.push([k, r[1], r[2], r[3], r[4], r[5]]);
  }
  return out;
}
const groupYear = rows => groupBy(rows, t => Date.UTC(new Date(t * 1000).getUTCFullYear(), 0, 1) / 1000);
function cleanRows(rows) {
  rows = rows.filter(r => [1, 2, 3, 4].every(k => typeof r[k] === 'number' && isFinite(r[k])));
  const clean = [];
  for (const r of rows) { if (!clean.length || r[0] > clean[clean.length - 1][0]) clean.push(r); else if (r[0] === clean[clean.length - 1][0]) clean[clean.length - 1] = r; }
  return clean;
}

// =====================================================================
//  KERZEN für den Live-Trader – mit allen Ersatz-Quellen
// =====================================================================
const CANDLE_TF = {
  '15m': ['15m', '10d'], '1h': ['60m', '60d'], '4h': ['60m', '6mo', 4],
  '1d': ['1d', '2y'], '1w': ['1wk', '10y'], '1M': ['1mo', 'max'], '1y': ['1mo', 'max', 'year']
};
async function yahooCandles(symbol, tf) {
  const [interval, range, group] = CANDLE_TF[tf];
  const intraday = ['15m', '1h', '4h'].includes(tf);
  const j = await yahoo(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false`, intraday ? 60 : 600);
  const res = j && j.chart && j.chart.result && j.chart.result[0];
  if (!res) throw new NotFound((j && j.chart && j.chart.error && j.chart.error.description) || 'Symbol nicht gefunden');
  const m = res.meta || {}, q = (((res.indicators || {}).quote || [])[0]) || {};
  let rows = (res.timestamp || []).map((t, i) => [t, q.open && q.open[i], q.high && q.high[i], q.low && q.low[i], q.close && q.close[i], (q.volume && q.volume[i]) || 0])
    .filter(r => [1, 2, 3, 4].every(k => typeof r[k] === 'number'));
  if (group === 'year') rows = groupYear(rows);
  else if (group) rows = groupBy(rows, t => Math.floor(t / (3600 * group)) * 3600 * group);
  return {
    rows, name: m.longName || m.shortName || symbol, currency: m.currency || '', exchange: m.fullExchangeName || m.exchangeName || '',
    type: m.instrumentType || '', price: m.regularMarketPrice, prevClose: m.previousClose ?? m.chartPreviousClose, source: 'Yahoo'
  };
}
async function candlesAny(symbol, tf, env) {
  const errs = [];
  const sources = isCrypto(symbol)
    ? [() => yahooCandles(symbol, tf), () => binanceCandles(symbol, tf), () => coinbaseCandles(symbol, tf), () => twelveCandles(symbol, tf, env)]
    : [() => yahooCandles(symbol, tf), () => twelveCandles(symbol, tf, env)];
  let notFound = 0;
  for (const src of sources) {
    try {
      const d = await src(); d.rows = cleanRows(d.rows);
      if (d.rows.length) return d;
      errs.push((d.source || '?') + ': keine Daten');
    } catch (e) { if (e instanceof NotFound) notFound++; errs.push(e.message); }
  }
  if (notFound === sources.length || (notFound && !isCrypto(symbol) && !(env && env.TWELVE_KEY))) throw new NotFound('Symbol nicht gefunden – prüfe die Schreibweise (z. B. NESN.SW für Nestlé, BTC-USD für Bitcoin).');
  throw new Error('Keine Kursquelle erreichbar: ' + errs.join(' · ') + (isCrypto(symbol) || (env && env.TWELVE_KEY) ? '' : ' – Tipp: kostenlosen Twelve-Data-Schlüssel als TWELVE_KEY in Cloudflare hinterlegen.'));
}
async function candles(symbol, tf, env) {
  const d = await candlesAny(symbol, tf, env), rows = d.rows;
  return {
    symbol, name: d.name || symbol, currency: d.currency || '', exchange: d.exchange || '', type: d.type || '', tf, source: d.source,
    price: d.price ?? (rows.length ? rows[rows.length - 1][4] : null), candles: rows.slice(-500)
  };
}

// =====================================================================
//  KURS + LINIE (Portfolio, Watchlist, Übersicht)
// =====================================================================
const CHART_TF = { '1d': '15m', '5d': '1h', '1mo': '1d', '6mo': '1d', '1y': '1d', '5y': '1w' };
const CHART_SPAN = { '1d': 1, '5d': 5, '1mo': 31, '6mo': 183, '1y': 366, '5y': 1830 };
async function chart(symbol, range, env) {
  // zuerst Yahoo direkt (gleich wie früher)
  try {
    const interval = RANGES[range] || '1d';
    const j = await yahoo(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false`, range === '1d' ? 60 : 600);
    const res = j && j.chart && j.chart.result && j.chart.result[0];
    if (!res) throw new NotFound((j && j.chart && j.chart.error && j.chart.error.description) || 'Symbol nicht gefunden');
    const m = res.meta || {};
    const closes = (((res.indicators || {}).quote || [])[0] || {}).close || [];
    const points = (res.timestamp || []).map((t, i) => [t * 1000, closes[i]]).filter(p => typeof p[1] === 'number');
    const price = m.regularMarketPrice ?? (points.length ? points[points.length - 1][1] : null);
    const prevClose = m.chartPreviousClose ?? m.previousClose ?? null;
    return {
      symbol: m.symbol || symbol, name: m.longName || m.shortName || symbol, currency: m.currency || '',
      exchange: m.fullExchangeName || m.exchangeName || '', type: m.instrumentType || '',
      price, prevClose, dayChangePct: price != null && m.previousClose ? (price - m.previousClose) / m.previousClose * 100 : null,
      marketTime: (m.regularMarketTime || 0) * 1000, range, points, source: 'Yahoo'
    };
  } catch (e) {
    if (e instanceof NotFound && !isCrypto(symbol)) throw e;
  }
  // Ersatz: aus Kerzen der anderen Quellen bauen
  const tf = CHART_TF[range] || '1d', d = await candlesAny(symbol, tf, env), rows = d.rows;
  const last = rows[rows.length - 1], from = last[0] - CHART_SPAN[range] * 86400;
  const pts = rows.filter(r => r[0] >= from).map(r => [r[0] * 1000, r[4]]);
  // Tagesveränderung: Schlusskurs von vor ~24 h
  const dayAgo = rows.filter(r => r[0] <= last[0] - 86400 + 60).pop();
  const prev = tf === '1d' || tf === '1w' ? (rows[rows.length - 2] || last)[4] : (dayAgo || rows[0])[4];
  return {
    symbol, name: d.name || symbol, currency: d.currency || '', exchange: d.exchange || '', type: d.type || '',
    price: last[4], prevClose: prev, dayChangePct: prev ? (last[4] - prev) / prev * 100 : null,
    marketTime: last[0] * 1000, range, points: pts.length > 1 ? pts : rows.slice(-30).map(r => [r[0] * 1000, r[4]]), source: d.source
  };
}
// Viele Kurse auf einmal (1 Anfrage statt 20) – braucht den Yahoo-Ausweis
async function quoteMany(list) {
  const j = await yahoo(`https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(list.join(','))}`, 60);
  const res = ((j || {}).quoteResponse || {}).result || [];
  if (!res.length) throw new Error('leer');
  return res.map(q => ({ symbol: q.symbol, name: q.longName || q.shortName || q.symbol, price: q.regularMarketPrice, currency: q.currency || '', dayChangePct: q.regularMarketChangePercent, type: q.quoteType }));
}
async function manyPrices(list, env) {
  try { const r = await quoteMany(list); if (r.length >= Math.min(3, list.length)) return r; } catch (e) { }
  const out = [];
  // in kleinen Gruppen, damit die Quellen nicht überlastet werden
  for (let i = 0; i < list.length; i += 5) {
    const part = await Promise.allSettled(list.slice(i, i + 5).map(s => chart(s, '1d', env)));
    part.forEach(r => { if (r.status === 'fulfilled') { const c = r.value; out.push({ symbol: c.symbol, name: c.name, price: c.price, currency: c.currency, dayChangePct: c.dayChangePct }); } });
  }
  return out;
}

// =====================================================================
export async function onRequestGet({ request, env }) {
  const u = new URL(request.url); const action = u.searchParams.get('action');
  try {
    if (action === 'chart') {
      const symbol = cleanSymbol(u.searchParams.get('symbol')); if (!symbol) return json({ ok: false, error: 'Kein Symbol' }, 400);
      const range = RANGES[u.searchParams.get('range')] ? u.searchParams.get('range') : '1mo';
      return json(Object.assign({ ok: true }, await chart(symbol, range, env)), 200, range === '1d' ? 60 : 600);
    }
    if (action === 'candles') {
      const symbol = cleanSymbol(u.searchParams.get('symbol')); if (!symbol) return json({ ok: false, error: 'Kein Symbol' }, 400);
      const tf = CANDLE_TF[u.searchParams.get('tf')] ? u.searchParams.get('tf') : '1d';
      return json(Object.assign({ ok: true }, await candles(symbol, tf, env)), 200, ['15m', '1h', '4h'].includes(tf) ? 30 : 300);
    }
    if (action === 'search') {
      const q = String(u.searchParams.get('q') || '').trim().slice(0, 50); if (!q) return json({ ok: true, results: [] });
      try {
        const j = await yahoo(`https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0&lang=de-CH`, 3600);
        const results = (j.quotes || []).filter(x => x.symbol).map(x => ({ symbol: x.symbol, name: x.longname || x.shortname || x.symbol, type: x.quoteType || '', exchange: x.exchDisp || '' }));
        return json({ ok: true, results }, 200, 3600);
      } catch (e) {
        // Ersatz-Suche: bekannte Werte + Krypto
        const Q = q.toUpperCase(), all = Object.values(UNIVERSE).flat();
        const results = all.filter(s => s.includes(Q) || (CRYPTO_NAMES[s.split('-')[0]] || '').toUpperCase().includes(Q)).slice(0, 8).map(s => ({ symbol: s, name: CRYPTO_NAMES[s.split('-')[0]] || s, type: isCrypto(s) ? 'CRYPTOCURRENCY' : '', exchange: '' }));
        if (/^[A-Z0-9]{2,10}$/.test(Q) && !results.some(r => r.symbol === Q + '-USD')) results.push({ symbol: Q + '-USD', name: Q + ' (Krypto)', type: 'CRYPTOCURRENCY', exchange: '' });
        if (/^[A-Z0-9.]{1,12}$/.test(Q) && !results.some(r => r.symbol === Q)) results.unshift({ symbol: Q, name: Q, type: '', exchange: '' });
        return json({ ok: true, results, note: 'Suche eingeschränkt (Yahoo nicht erreichbar)' }, 200, 60);
      }
    }
    if (action === 'trending') {
      let syms = [];
      try {
        const j = await yahoo('https://query1.finance.yahoo.com/v1/finance/trending/US?count=12', 600);
        syms = ((((j.finance || {}).result || [])[0] || {}).quotes || []).map(x => x.symbol).filter(Boolean).slice(0, 10);
      } catch (e) { syms = ['NVDA', 'TSLA', 'AAPL', 'MSFT', 'AMZN', 'META', 'BTC-USD', 'ETH-USD']; }
      return json({ ok: true, items: await manyPrices(syms, env) }, 200, 600);
    }
    if (action === 'overview') {
      const cat = u.searchParams.get('cat'); const list = UNIVERSE[cat];
      if (!list) return json({ ok: false, error: 'Unbekannte Kategorie' }, 400);
      const items = (await manyPrices(list, env)).map(x => Object.assign(x, { cat }));
      return json({ ok: true, cat, items }, 200, 120);
    }
    if (action === 'movers') {
      const id = ['day_gainers', 'day_losers', 'most_actives'].includes(u.searchParams.get('type')) ? u.searchParams.get('type') : 'day_gainers';
      const j = await yahoo(`https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=${id}&count=15`, 300);
      const quotes = ((((j.finance || {}).result || [])[0] || {}).quotes || []);
      const items = quotes.map(q => ({ symbol: q.symbol, name: q.shortName || q.longName || q.symbol, price: q.regularMarketPrice, currency: q.currency || '', dayChangePct: q.regularMarketChangePercent, type: q.quoteType || '' }));
      return json({ ok: true, type: id, items }, 200, 300);
    }
    if (action === 'diag') {
      const test = async f => { const t = Date.now(); try { const r = await f(); return { ok: true, ms: Date.now() - t, info: r }; } catch (e) { return { ok: false, ms: Date.now() - t, error: e.message }; } };
      yDownUntil = 0; const a = await yAuth(true);
      return json({
        ok: true,
        yahooAusweis: { cookie: !!a.cookie, crumb: !!a.crumb, error: a.err || null },
        yahoo: await test(async () => (await yahooCandles('AAPL', '1d')).rows.length + ' Kerzen'),
        binance: await test(async () => (await binanceCandles('BTC-USD', '1d')).rows.length + ' Kerzen'),
        coinbase: await test(async () => (await coinbaseCandles('BTC-USD', '1d')).rows.length + ' Kerzen'),
        twelve: env && env.TWELVE_KEY ? await test(async () => (await twelveCandles('AAPL', '1d', env)).rows.length + ' Kerzen') : { ok: false, error: 'TWELVE_KEY nicht hinterlegt' }
      }, 200, 0);
    }
    return json({ ok: false, error: 'Unbekannte Aktion' }, 400);
  } catch (e) {
    return json({ ok: false, error: e.message || 'Fehler' }, e instanceof NotFound ? 404 : 502, 0);
  }
}
