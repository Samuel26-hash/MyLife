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

const MODELS = ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'];

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
  let first = null, last = null;
  for (const c of candidates(env)) {
    let r;
    try { r = await once(key, c, body); } catch (e) { r = { ok: false, status: 0, message: e.message }; }
    if (r.ok) { remembered = { key: key.slice(0, 12) + key.length, target: c.target, model: c.model }; return { ok: true, text: r.text, model: c.model, target: c.target }; }
    if (!first) first = r;
    last = r;
    if (r.status === 429) break;          // Kontingent aufgebraucht – weiterprobieren bringt nichts
    if (r.empty) return { ok: false, error: 'empty', message: r.message };
  }
  remembered = null;
  const best = first && first.status !== 404 ? first : last;   // aussagekräftigste Fehlermeldung
  return { ok: false, error: 'ai_error', status: best && best.status, message: best && best.message };
}

export function keyType(key) {
  key = String(key || '').trim();
  if (!key) return null;
  if (key.startsWith('AIza')) return 'Google-Schlüssel (altes AIza-Format)';
  if (key.startsWith('AQ.')) return 'Google-Schlüssel (neues AQ-Format)';
  return 'unbekanntes Format – prüfe, ob du den ganzen Schlüssel kopiert hast';
}
