// Cloudflare Pages Function – erreichbar unter /api/capital
// Zeigt dein Capital.com-Konto in MyLife an: Kontostand und offene Positionen.
// NUR LESEN – diese Datei kann nichts kaufen, verkaufen oder auszahlen.
//
// Secrets in Cloudflare (Settings → Variables and Secrets, Typ "Secret"):
//   CAPITAL_API_KEY     – API-Key aus Capital.com (Einstellungen → API-Integrationen)
//   CAPITAL_IDENTIFIER  – deine Capital.com-Login-E-Mail
//   CAPITAL_PASSWORD    – das "Custom password", das du beim Erstellen des API-Keys festlegst
//   CAPITAL_OWNER       – dein MyLife-Benutzername (nur dieses Konto darf die Daten sehen)
//   CAPITAL_DEMO        – optional: 1 = Demo-Konto statt echtem Konto
// Braucht dieselbe KV-Bindung MYLIFE wie account.js (für die Anmelde-Prüfung).

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
});
const LIVE = 'https://api-capital.backend-capital.com';
const DEMO = 'https://demo-api-capital.backend-capital.com';
const num = v => (typeof v === 'number' && isFinite(v) ? v : null);

export async function onRequestPost({ request, env, waitUntil }) {
  let b = {};
  try { b = await request.json(); } catch (e) { }
  if (!env.MYLIFE) return json({ ok: false, error: 'KV-Bindung MYLIFE fehlt.' });
  const username = b.token ? await env.MYLIFE.get('session:' + b.token) : null;
  if (!username) return json({ ok: false, code: 'no_session', error: 'Bitte zuerst in MyLife anmelden.' }, 401);
  if (!env.CAPITAL_API_KEY || !env.CAPITAL_IDENTIFIER || !env.CAPITAL_PASSWORD || !env.CAPITAL_OWNER) {
    return json({ ok: false, code: 'not_configured', error: 'Capital.com ist noch nicht eingerichtet (Secrets in Cloudflare fehlen).' });
  }
  if (String(username).toLowerCase() !== String(env.CAPITAL_OWNER).trim().toLowerCase()) {
    return json({ ok: false, code: 'not_owner', error: 'Dieses MyLife-Konto ist nicht für Capital.com freigeschaltet.' }, 403);
  }

  const demo = String(env.CAPITAL_DEMO || '') === '1', base = demo ? DEMO : LIVE;
  try {
    const s = await fetch(base + '/api/v1/session', {
      method: 'POST',
      headers: { 'X-CAP-API-KEY': env.CAPITAL_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: env.CAPITAL_IDENTIFIER, password: env.CAPITAL_PASSWORD, encryptedPassword: false })
    });
    if (!s.ok) {
      const t = (await s.text()).slice(0, 160);
      return json({ ok: false, code: 'login_failed', error: `Capital.com-Login fehlgeschlagen (${s.status}). Prüfe API-Key, E-Mail und Custom password${demo ? ' (Demo-Konto)' : ''}. ${t}` });
    }
    const h = { 'X-SECURITY-TOKEN': s.headers.get('X-SECURITY-TOKEN') || '', CST: s.headers.get('CST') || '' };
    const [a, p] = await Promise.all([
      fetch(base + '/api/v1/accounts', { headers: h }).then(r => r.json()),
      fetch(base + '/api/v1/positions', { headers: h }).then(r => r.json())
    ]);
    const bye = fetch(base + '/api/v1/session', { method: 'DELETE', headers: h }).catch(() => { });
    if (waitUntil) waitUntil(bye);

    const accounts = (a.accounts || []).map(x => {
      const bal = x.balance || {};
      return { id: x.accountId, name: x.accountName, currency: x.currency || '', preferred: !!x.preferred, type: x.accountType || '',
        balance: num(bal.balance), deposit: num(bal.deposit), profitLoss: num(bal.profitLoss), available: num(bal.available) };
    });
    const positions = (p.positions || []).map(x => {
      const pos = x.position || {}, m = x.market || {};
      return { dealId: pos.dealId, epic: m.epic, name: m.instrumentName || m.epic, type: m.instrumentType || '',
        direction: pos.direction, size: num(pos.size), open: num(pos.level), bid: num(m.bid), offer: num(m.offer),
        upl: num(pos.upl), currency: pos.currency || '', leverage: num(pos.leverage), created: pos.createdDateUTC || pos.createdDate || '' };
    });
    return json({ ok: true, demo, accounts, positions, at: Date.now() });
  } catch (e) {
    return json({ ok: false, code: 'error', error: 'Capital.com nicht erreichbar: ' + (e.message || e) }, 502);
  }
}
