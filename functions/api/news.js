// Cloudflare Pages Function – erreichbar unter /api/news
// Holt Google-News-RSS-Feeds serverseitig (der Browser darf das wegen CORS nicht direkt)
// und gibt sie an MyLife weiter. Ergebnis wird 10 Minuten zwischengespeichert.
//   /api/news            → Schweizer Schlagzeilen (Standard)
//   /api/news?url=...    → beliebiger Google-News-Feed (z. B. Suche nach einer Aktie)
// So funktionieren die News auch in Netzen, die fremde Dienste sperren (z. B. Schul-WLAN).
const FEED = 'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGx1YlY4U0FtUmxHZ0pEU0NnQVAB?hl=de&gl=CH&ceid=CH:de';

export async function onRequestGet({ request }) {
  let feed = FEED, custom = false;
  const u = new URL(request.url).searchParams.get('url');
  if (u) {
    let ok = false;
    try { const x = new URL(u); ok = x.protocol === 'https:' && x.hostname === 'news.google.com' && x.pathname.startsWith('/rss'); } catch (e) { }
    if (!ok) return new Response('Nur Google-News-Feeds sind erlaubt', { status: 400 });
    feed = u; custom = true;
  }
  try {
    const res = await fetch(feed, {
      headers: { 'User-Agent': 'Mozilla/5.0 (MyLife News)' },
      cf: { cacheTtl: 600, cacheEverything: true }
    });
    if (!res.ok) return new Response('Feed nicht erreichbar', { status: 502 });
    const headers = {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=600'
    };
    if (custom) headers['X-MyLife-Feed'] = 'url';
    return new Response(await res.text(), { headers });
  } catch (err) {
    return new Response('Fehler: ' + err.message, { status: 500 });
  }
}
