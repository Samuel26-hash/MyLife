// Cloudflare Pages Function – erreichbar unter /api/news
// Holt den Google-News-RSS-Feed serverseitig (der Browser darf das wegen CORS nicht direkt)
// und gibt ihn an MyLife weiter. Ergebnis wird 10 Minuten zwischengespeichert.
const FEED = 'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGx1YlY4U0FtUmxHZ0pEU0NnQVAB?hl=de&gl=CH&ceid=CH:de';

export async function onRequestGet() {
  try {
    const res = await fetch(FEED, {
      headers: { 'User-Agent': 'Mozilla/5.0 (MyLife News)' },
      cf: { cacheTtl: 600, cacheEverything: true }
    });
    if (!res.ok) return new Response('Feed nicht erreichbar', { status: 502 });
    return new Response(await res.text(), {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, max-age=600'
      }
    });
  } catch (err) {
    return new Response('Fehler: ' + err.message, { status: 500 });
  }
}
