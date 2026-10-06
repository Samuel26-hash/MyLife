// Cloudflare Pages Function – erreichbar unter /api/account
// Cloud-Konten für MyLife: Registrieren, Anmelden, E-Mail-Bestätigung,
// Passwort zurücksetzen und Daten-Sync zwischen allen Geräten.
//
// Benötigt eine KV-Bindung mit dem Variablennamen MYLIFE.
// Optional für E-Mails (EmailJS): EMAILJS_SERVICE, EMAILJS_TEMPLATE,
// EMAILJS_PUBLIC, EMAILJS_PRIVATE als Umgebungsvariablen.

const MAX_DATA = 20 * 1024 * 1024; // KV-Limit liegt bei 25 MB pro Wert
const SESSION_TTL = 60 * 60 * 24 * 120; // 120 Tage angemeldet bleiben
const enc = new TextEncoder();

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
});
const fail = (error, status = 200, extra = {}) => json(Object.assign({ ok: false, error }, extra), status);

function toB64(buf) { let s = ''; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s); }
function fromB64(s) { return Uint8Array.from(atob(s), c => c.charCodeAt(0)); }
function token() { return toB64(crypto.getRandomValues(new Uint8Array(32))).replace(/[+/=]/g, c => ({ '+': '-', '/': '_', '=': '' }[c])); }
function code6() { return String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0'); }
function sameStr(a, b) { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }
const isEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v || '');
const norm = v => String(v || '').trim().toLowerCase();

async function hashPassword(password, saltB64) {
  const salt = saltB64 ? fromB64(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256);
  return { salt: toB64(salt), hash: toB64(bits) };
}

const mailReady = env => !!(env.EMAILJS_SERVICE && env.EMAILJS_TEMPLATE && env.EMAILJS_PUBLIC && env.EMAILJS_PRIVATE);
async function sendMail(env, user, code, purpose) {
  const r = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      service_id: env.EMAILJS_SERVICE, template_id: env.EMAILJS_TEMPLATE,
      user_id: env.EMAILJS_PUBLIC, accessToken: env.EMAILJS_PRIVATE,
      template_params: { to_email: user.email, to_name: user.display || user.username, code, app_name: 'MYLife', purpose }
    })
  });
  if (!r.ok) throw new Error('E-Mail-Versand fehlgeschlagen (' + r.status + ')');
}

async function getJSON(kv, key) { const v = await kv.get(key); return v ? JSON.parse(v) : null; }
async function findUser(kv, login) {
  const l = norm(login); if (!l) return null;
  let u = await getJSON(kv, 'user:' + l);
  if (!u && isEmail(l)) { const name = await kv.get('email:' + l); if (name) u = await getJSON(kv, 'user:' + name); }
  return u;
}
async function newSession(kv, username) { const t = token(); await kv.put('session:' + t, username, { expirationTtl: SESSION_TTL }); return t; }
async function sessionUser(kv, t) { if (!t || typeof t !== 'string') return null; const name = await kv.get('session:' + t); return name ? getJSON(kv, 'user:' + name) : null; }
async function dataOf(kv, username) { return (await getJSON(kv, 'data:' + username)) || { updatedAt: 0, data: null }; }
async function startCode(env, kv, user, kind, purpose) {
  const c = code6();
  await kv.put(kind + ':' + user.username, JSON.stringify({ code: c, tries: 0 }), { expirationTtl: kind === 'reset' ? 900 : 1800 });
  await sendMail(env, user, c, purpose);
}
async function checkCode(kv, user, kind, given) {
  const key = kind + ':' + user.username; const rec = await getJSON(kv, key);
  if (!rec) return 'expired';
  if (rec.tries >= 5) return 'too_many';
  if (!sameStr(String(given || ''), rec.code)) { rec.tries++; await kv.put(key, JSON.stringify(rec), { expirationTtl: 900 }); return 'wrong_code'; }
  await kv.delete(key); return null;
}
async function loginOk(kv, user) {
  const t = await newSession(kv, user.username); const d = await dataOf(kv, user.username);
  return json({ ok: true, token: t, username: user.username, email: user.email, data: d.data, updatedAt: d.updatedAt });
}

export async function onRequestPost({ request, env }) {
  const kv = env.MYLIFE;
  if (!kv) return fail('no_kv', 500);
  let b; try { b = await request.json(); } catch (e) { return fail('bad_request', 400); }
  const a = b.action;

  try {
    if (a === 'ping') return json({ ok: true, mail: mailReady(env) });

    if (a === 'register') {
      const username = norm(b.username), email = norm(b.email), pw = String(b.password || '');
      if (username.length < 2 || username.length > 40 || username.startsWith('gast_')) return fail('bad_username');
      if (!isEmail(email)) return fail('bad_email');
      if (pw.length < 6) return fail('short_password');
      if (await kv.get('user:' + username)) return fail('username_taken');
      if (await kv.get('email:' + email)) return fail('email_taken');
      const { salt, hash } = await hashPassword(pw);
      const user = { username, display: String(b.display || username).slice(0, 60), email, salt, hash, verified: !mailReady(env), createdAt: Date.now() };
      await kv.put('user:' + username, JSON.stringify(user));
      await kv.put('email:' + email, username);
      if (b.data) {
        const s = JSON.stringify({ updatedAt: Number(b.updatedAt) || Date.now(), data: b.data });
        if (s.length <= MAX_DATA) await kv.put('data:' + username, s);
      }
      if (!user.verified) { await startCode(env, kv, user, 'verify', 'E-Mail bestätigen'); return json({ ok: true, needVerify: true, username, email }); }
      return loginOk(kv, user);
    }

    if (a === 'login') {
      const user = await findUser(kv, b.login);
      if (!user) return fail('not_found');
      const failKey = 'fail:' + user.username;
      const fails = Number(await kv.get(failKey)) || 0;
      if (fails >= 10) return fail('locked');
      const { hash } = await hashPassword(String(b.password || ''), user.salt);
      if (!sameStr(hash, user.hash)) { await kv.put(failKey, String(fails + 1), { expirationTtl: 900 }); return fail('wrong_password'); }
      await kv.delete(failKey);
      if (!user.verified) {
        if (mailReady(env)) { await startCode(env, kv, user, 'verify', 'E-Mail bestätigen'); return fail('unverified', 200, { username: user.username, email: user.email }); }
        user.verified = true; await kv.put('user:' + user.username, JSON.stringify(user));
      }
      return loginOk(kv, user);
    }

    if (a === 'verify') {
      const user = await findUser(kv, b.login); if (!user) return fail('not_found');
      const err = await checkCode(kv, user, 'verify', b.code); if (err) return fail(err);
      user.verified = true; await kv.put('user:' + user.username, JSON.stringify(user));
      return loginOk(kv, user);
    }

    if (a === 'resend') {
      const user = await findUser(kv, b.login); if (!user) return fail('not_found');
      if (user.verified) return fail('already_verified');
      if (!mailReady(env)) return fail('mail_off');
      await startCode(env, kv, user, 'verify', 'E-Mail bestätigen');
      return json({ ok: true, email: user.email });
    }

    if (a === 'reset-request') {
      const user = await findUser(kv, b.email); if (!user) return fail('not_found');
      if (!mailReady(env)) return fail('mail_off');
      await startCode(env, kv, user, 'reset', 'Passwort zurücksetzen');
      return json({ ok: true, email: user.email });
    }

    if (a === 'reset-confirm') {
      const user = await findUser(kv, b.email); if (!user) return fail('not_found');
      if (String(b.password || '').length < 6) return fail('short_password');
      const err = await checkCode(kv, user, 'reset', b.code); if (err) return fail(err);
      Object.assign(user, await hashPassword(String(b.password)), { verified: true });
      await kv.put('user:' + user.username, JSON.stringify(user));
      await kv.delete('fail:' + user.username);
      return json({ ok: true, username: user.username });
    }

    // ---- ab hier nur mit gültiger Sitzung ----
    const user = await sessionUser(kv, b.token);
    if (!user) return fail('no_session', 401);

    if (a === 'pull') { const d = await dataOf(kv, user.username); return json({ ok: true, data: d.data, updatedAt: d.updatedAt }); }

    if (a === 'push') {
      const updatedAt = Number(b.updatedAt) || Date.now();
      const cur = await dataOf(kv, user.username);
      if (cur.updatedAt > updatedAt && !b.force) return fail('stale', 200, { data: cur.data, updatedAt: cur.updatedAt });
      const s = JSON.stringify({ updatedAt, data: b.data });
      if (s.length > MAX_DATA) return fail('too_large');
      await kv.put('data:' + user.username, s);
      return json({ ok: true, updatedAt });
    }

    if (a === 'update-account') {
      const out = { ok: true };
      if (b.password) {
        if (String(b.password).length < 6) return fail('short_password');
        Object.assign(user, await hashPassword(String(b.password)));
      }
      const email = norm(b.email);
      if (email && email !== user.email) {
        if (!isEmail(email)) return fail('bad_email');
        if (await kv.get('email:' + email)) return fail('email_taken');
        await kv.delete('email:' + user.email);
        await kv.put('email:' + email, user.username);
        user.email = email;
        if (mailReady(env)) { user.verified = false; out.needVerify = true; }
      }
      await kv.put('user:' + user.username, JSON.stringify(user));
      if (out.needVerify) await startCode(env, kv, user, 'verify', 'E-Mail bestätigen');
      return json(out);
    }

    if (a === 'logout') { await kv.delete('session:' + b.token); return json({ ok: true }); }

    return fail('unknown_action', 400);
  } catch (e) {
    return fail('server_error', 500, { message: e.message });
  }
}

export async function onRequestGet() { return json({ ok: true, service: 'mylife-account' }); }
