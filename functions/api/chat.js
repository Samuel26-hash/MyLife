// Cloudflare Pages Function – erreichbar unter /api/chat
// KI-Assistent für MyLife. Der API-Schlüssel liegt NUR hier auf dem Server
// (Cloudflare-Secret GEMINI_API_KEY), niemals in der index.html.
// Nur angemeldete Cloud-Nutzer dürfen chatten (Schutz vor fremder Nutzung).
//
// Umgebungsvariablen:
//   GEMINI_API_KEY  (Secret) – Vertex-AI-Express-Schlüssel ("AQ....") oder AI-Studio-Schlüssel ("AIza...")
//   GEMINI_MODEL    (optional) – Standard: gemini-2.5-flash
//   CHAT_DAILY_LIMIT (optional) – Nachrichten pro Tag und Nutzer, Standard 150

import { callAI } from '../../lib/gemini.js';

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

const SYSTEM = `Du bist der persönliche KI-Assistent in der App „MyLife“, einem Dashboard für Schule (WMS), Fitness, Fussball, Ernährung, Lesen, Lernen, Social Media und Routinen.
Antworte auf Deutsch (Schweizer Schreibweise mit „ss“ statt „ß“), freundlich, konkret und eher kurz. Nutze kurze Absätze; Listen nur, wenn sie wirklich helfen.
Der Nutzer ist jugendlich. Gib keine riskanten Gesundheits-, Diät- oder Trainingsratschläge; bei medizinischen Themen verweise auf Fachpersonen.
Bei Aktien/ETFs gibst du allgemeine Informationen, aber keine konkreten Kauf- oder Verkaufsempfehlungen.
Wenn dir Kontext aus der App mitgegeben wird, nutze ihn nur, wenn er zur Frage passt.`;

export async function onRequestPost({ request, env }) {
  if (!env.GEMINI_API_KEY && !env.AI) return json({ ok: false, error: 'no_key' });
  if (!env.MYLIFE) return json({ ok: false, error: 'no_kv' });
  let b; try { b = await request.json(); } catch (e) { return json({ ok: false, error: 'bad_request' }, 400); }

  const username = b.token ? await env.MYLIFE.get('session:' + b.token) : null;
  if (!username) return json({ ok: false, error: 'no_session' }, 401);

  const day = new Date().toISOString().slice(0, 10);
  const limitKey = `chatcount:${username}:${day}`;
  const used = Number(await env.MYLIFE.get(limitKey)) || 0;
  const limit = Number(env.CHAT_DAILY_LIMIT) || 150;
  if (used >= limit) return json({ ok: false, error: 'limit' });

  const msgs = (Array.isArray(b.messages) ? b.messages : []).slice(-14)
    .filter(m => m && typeof m.text === 'string' && m.text.trim())
    .map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.text.slice(0, 4000) }] }));
  if (!msgs.length || msgs[msgs.length - 1].role !== 'user') return json({ ok: false, error: 'bad_request' }, 400);

  const context = typeof b.context === 'string' ? b.context.slice(0, 2500) : '';
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM + (context ? `\n\nAktueller Kontext aus der App:\n${context}` : '') }] },
    contents: msgs,
    generationConfig: { temperature: 0.7, maxOutputTokens: 1024 }
  };
  const r = await callAI(env, body);
  if (!r.ok) return json({ ok: false, error: r.error, message: r.message });
  await env.MYLIFE.put(limitKey, String(used + 1), { expirationTtl: 60 * 60 * 26 });
  return json({ ok: true, text: r.text, provider: r.target === 'cloudflare' ? 'Cloudflare' : 'Gemini' });
}
