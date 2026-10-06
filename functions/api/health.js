// /api/health – System-Check: Läuft der Server-Teil? Sind Datenbank, KI-Schlüssel
// und E-Mail eingerichtet? Gibt KEINE geheimen Werte heraus.
import { callAI, keyType } from '../../lib/gemini.js';
const json = obj => new Response(JSON.stringify(obj), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

export async function onRequestGet({ request, env, runtime }) {
  const url = new URL(request.url);
  const out = {
    ok: true, server: true, runtime: runtime || 'pages',
    kv: !!env.MYLIFE,
    ai: !!env.GEMINI_API_KEY,
    workersAI: !!env.AI, aiType: keyType(env.GEMINI_API_KEY || ''),
    model: env.GEMINI_MODEL || 'automatisch',
    keyLength: (env.GEMINI_API_KEY || '').trim().length,
    keyHasSpaces: /\s/.test(env.GEMINI_API_KEY || '') && (env.GEMINI_API_KEY || '').trim() !== (env.GEMINI_API_KEY || ''),
    mail: !!(env.EMAILJS_SERVICE && env.EMAILJS_TEMPLATE && env.EMAILJS_PUBLIC && env.EMAILJS_PRIVATE)
  };
  if (url.searchParams.get('test') === 'ai' && (env.GEMINI_API_KEY || env.AI)) {
    // höchstens ein Test pro Minute, damit niemand deinen Schlüssel leer klickt
    if (env.MYLIFE && await env.MYLIFE.get('healthtest')) out.aiTest = { ok: false, wait: true };
    else {
      if (env.MYLIFE) await env.MYLIFE.put('healthtest', '1', { expirationTtl: 60 }); // KV-Minimum sind 60 s
      const r = await callAI(env, { contents: [{ role: 'user', parts: [{ text: 'Antworte nur mit: OK' }] }], generationConfig: { maxOutputTokens: 10 } });
      out.aiTest = r.ok ? { ok: true, message: r.text, model: r.model, target: r.target, fallbackFrom: r.fallbackFrom || null } : { ok: false, status: r.status, message: r.message || r.error, details: r.details };
    }
  }
  return json(out);
}
