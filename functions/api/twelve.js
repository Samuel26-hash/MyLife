// Cloudflare Pages Function: /api/twelve
// Leitet Anfragen an Twelve Data weiter und hängt den geheimen Key an.
// Der Key steht NICHT im Code, sondern in Cloudflare als Secret "TWELVE_KEY".
const ALLOWED = ['time_series', 'price'];

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const endpoint = url.searchParams.get('endpoint');
  if (!ALLOWED.includes(endpoint)) {
    return Response.json({ status: 'error', message: 'Unbekannter Endpoint' }, { status: 400 });
  }
  if (!env.TWELVE_KEY) {
    return Response.json({ status: 'error', message: 'TWELVE_KEY fehlt in Cloudflare (Settings → Variables and Secrets)' }, { status: 500 });
  }
  const q = new URLSearchParams();
  for (const k of ['symbol', 'interval', 'outputsize']) {
    const v = url.searchParams.get(k);
    if (v) q.set(k, v);
  }
  q.set('apikey', env.TWELVE_KEY);

  const r = await fetch(`https://api.twelvedata.com/${endpoint}?${q}`, { cf: { cacheTtl: 30 } });
  return new Response(r.body, {
    status: r.status,
    headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=30' }
  });
}
