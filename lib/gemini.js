// Gemeinsamer Baustein: Anfrage an Google Gemini (für Chat und System-Check).
//
// Seit Juni 2026 erstellt Google AI Studio nur noch Schlüssel im neuen Format
// "AQ.…" (vorher "AIza…"). Diese funktionieren an der normalen Gemini-Adresse
// (generativelanguage.googleapis.com) mit dem Header x-goog-api-key.
// Ältere Vertex-AI-Express-Schlüssel beginnen ebenfalls mit "AQ." und laufen
// über aiplatform.googleapis.com. Darum probieren wir der Reihe nach:
//   1. normale Gemini-Adresse mit mehreren aktuellen Modellen
//   2. falls der Schlüssel dort abgelehnt wird: Vertex-AI-Express-Adresse
// Was zuletzt funktioniert hat, merken wir uns (pro Server-Instanz).

let remembered = null; // { key, target, model }

const MODELS = ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-flash-lite-latest', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'];

function candidates(env) {
  const preferred = env.GEMINI_MODEL ? [String(env.GEMINI_MODEL).trim()] : [];
  const models = [...new Set([...preferred, ...MODELS])];
  const key = String(env.GEMINI_API_KEY || '').trim();
  const studioOnly = key.startsWith('AIza');
  const list = [];
  if (remembered && remembered.key === key.slice(0, 12) + key.length) list.push({ target: remembered.target, model: remembered.model });
  models.forEach(m => list.push({ target: 'gemini', model: m }));
  models.forEach(m => list.push({ target: 'vertex', model: m }));
  return list.filter((c, i) => !(studioOnly && c.target === 'vertex') && list.findIndex(x => x.target === c.target && x.model === c.model) === i);
}

async function once(key, c, body) {
  const url = c.target === 'gemini'
    ? `https://generativelanguage.googleapis.com/v1beta/models/${c.model}:generateContent`
    : `https://aiplatform.googleapis.com/v1/publishers/google/models/${c.model}:generateContent`;
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = j.error || {};
    const reason = ((e.details || []).find(d => d.reason) || {}).reason || e.status || '';
    return { ok: false, status: r.status, message: (e.message || ('HTTP ' + r.status)) + (reason ? ` [${reason}]` : '') };
  }
  const cand = (j.candidates || [])[0] || {};
  const text = ((cand.content || {}).parts || []).map(p => p.text || '').join('').trim();
  if (!text) return { ok: false, status: 200, empty: true, message: cand.finishReason ? 'Keine Antwort (' + cand.finishReason + ')' : 'Leere Antwort' };
  return { ok: true, text };
}

export async function callGemini(env, body) {
  const key = String(env.GEMINI_API_KEY || '').trim();
  if (!key) return { ok: false, error: 'no_key' };
  let first = null, last = null; const byTarget = {};
  const started = Date.now(); let waited = false;
  for (const c of candidates(env)) {
    if (Date.now() - started > 12000) break;                    // max. ~12 s für Gemini, dann Ersatz-KI
    let r;
    try { r = await once(key, c, body); } catch (e) { r = { ok: false, status: 0, message: e.message }; }
    if (!r.ok && (r.status === 503 || r.status === 500) && !waited) { // Google überlastet: einmal kurz warten, nochmal
      waited = true;
      await new Promise(res => setTimeout(res, 1200));
      try { r = await once(key, c, body); } catch (e) { r = { ok: false, status: 0, message: e.message }; }
    }
    if (r.ok) { remembered = { key: key.slice(0, 12) + key.length, target: c.target, model: c.model }; return { ok: true, text: r.text, model: c.model, target: c.target }; }
    if (!first) first = r;
    if (!byTarget[c.target] || byTarget[c.target].status === 404) byTarget[c.target] = r;
    last = r;
    if (r.status === 429) break;          // Kontingent aufgebraucht – weiterprobieren bringt nichts
    if (r.empty) return { ok: false, error: 'empty', message: r.message };
  }
  remembered = null;
  const best = first && first.status !== 404 ? first : last;   // aussagekräftigste Fehlermeldung
  const details = {}; Object.entries(byTarget).forEach(([t, r]) => details[t] = `${r.status} ${r.message}`);
  return { ok: false, error: 'ai_error', status: best && best.status, message: best && best.message, details };
}

export function keyType(key) {
  key = String(key || '').trim();
  if (!key) return null;
  if (key.startsWith('AIza')) return 'Google-Schlüssel (altes AIza-Format)';
  if (key.startsWith('AQ.')) return 'Google-Schlüssel (neues AQ-Format)';
  return 'unbekanntes Format – prüfe, ob du den ganzen Schlüssel kopiert hast';
}

// ---------------------------------------------------------------------------
// Ersatz-KI: Cloudflare Workers AI (eingebaut, kein Schlüssel nötig).
// Wird benutzt, wenn Gemini nicht antwortet und im Projekt die Bindung "AI"
// (Settings → Bindings → Workers AI) eingerichtet ist.
const CF_MODELS = ['@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/meta/llama-3.1-8b-instruct'];

function toMessages(body) {
  const msgs = [];
  const sys = body.systemInstruction && body.systemInstruction.parts && body.systemInstruction.parts.map(p => p.text).join('\n');
  if (sys) msgs.push({ role: 'system', content: sys });
  (body.contents || []).forEach(c => msgs.push({ role: c.role === 'model' ? 'assistant' : 'user', content: (c.parts || []).map(p => p.text || '').join('') }));
  return msgs;
}
export async function callCloudflareAI(env, body) {
  if (!env.AI) return { ok: false, error: 'no_ai_binding' };
  let lastErr = '';
  for (const model of CF_MODELS) {
    try {
      const r = await env.AI.run(model, { messages: toMessages(body), max_tokens: Math.min(1024, (body.generationConfig || {}).maxOutputTokens || 1024) });
      const text = String((r && (r.response ?? r.result?.response)) || '').trim();
      if (text) return { ok: true, text, model, target: 'cloudflare' };
      lastErr = 'Leere Antwort';
    } catch (e) { lastErr = e.message; }
  }
  return { ok: false, error: 'ai_error', message: 'Cloudflare-KI: ' + lastErr };
}

// Hauptfunktion für Chat & Check: erst Gemini, dann Cloudflare als Ersatz
export async function callAI(env, body) {
  let g = null;
  if (env.GEMINI_API_KEY) {
    g = await callGemini(env, body);
    if (g.ok) return g;
  }
  if (env.AI) {
    const c = await callCloudflareAI(env, body);
    if (c.ok) return Object.assign(c, { fallbackFrom: g ? g.message : null });
    if (!g) return c;
    return Object.assign({}, g, { details: Object.assign({}, g.details, { cloudflare: c.message }) });
  }
  return g || { ok: false, error: 'no_key' };
}
