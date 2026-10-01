// MyLife API – läuft als Cloudflare Worker.
// Alles unter /api/* wird hier behandelt, alles andere liefert die React-App aus.
import {
  type Env,
  checkLoginRateLimit,
  clearCookie,
  clientIp,
  createSession,
  destroySession,
  hashPassword,
  newId,
  recordFailedLogin,
  requireUser,
  verifyPassword,
} from "./auth";
import { HttpError, error, isValidEmail, json, optDate, optText, readJson } from "./http";

type Handler = (req: Request, env: Env, params: URLSearchParams) => Promise<Response>;

// Tabellen mit Benutzerdaten (für Export). Reihenfolge egal, Löschen passiert per CASCADE.
const USER_TABLES = [
  "profiles", "subjects", "grades", "meals", "nutrition_entries", "water_entries", "nutrition_goals",
  "sports", "workouts", "workout_exercises", "football_matches", "transactions", "savings_goals",
  "calendar_events", "habits", "habit_entries", "social_media_usage", "social_accounts",
  "social_account_stats", "social_posts", "goals", "achievements",
] as const;

const PROFILE_FIELDS = {
  first_name: 60, last_name: 60, nationality: 60, city: 80, occupation: 120,
  interests: 500, hobbies: 500, favorite_sport: 80, strengths: 500, improve_areas: 500, goals_text: 1000,
} as const;

// ---------- Auth ----------
const register: Handler = async (req, env) => {
  const body = await readJson(req);
  const email = (optText(body.email, 254) ?? "").toLowerCase();
  const password = typeof body.password === "string" ? body.password : "";
  const firstName = optText(body.firstName, 60);

  if (!isValidEmail(email)) return error("Bitte gib eine gültige E-Mail-Adresse ein.");
  if (password.length < 10) return error("Das Passwort muss mindestens 10 Zeichen lang sein.");
  if (password.length > 200) return error("Das Passwort ist zu lang.");

  const exists = await env.DB.prepare("SELECT 1 FROM users WHERE email = ?").bind(email).first();
  if (exists) return error("Mit dieser E-Mail-Adresse gibt es schon ein Konto. Melde dich stattdessen an.", 409);

  const id = newId();
  const hash = await hashPassword(password);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)").bind(id, email, hash),
    env.DB.prepare("INSERT INTO profiles (user_id, first_name) VALUES (?, ?)").bind(id, firstName),
  ]);
  const cookie = await createSession(env, id);
  return json({ ok: true }, 201, { "Set-Cookie": cookie });
};

const login: Handler = async (req, env) => {
  const body = await readJson(req);
  const email = (optText(body.email, 254) ?? "").toLowerCase();
  const password = typeof body.password === "string" ? body.password : "";
  const ip = clientIp(req);
  await checkLoginRateLimit(env, ip, email);

  const user = await env.DB.prepare("SELECT id, password_hash FROM users WHERE email = ?")
    .bind(email)
    .first<{ id: string; password_hash: string }>();
  const ok = user ? await verifyPassword(password, user.password_hash) : false;
  if (!user || !ok) {
    await recordFailedLogin(env, ip, email);
    // Absichtlich gleiche Meldung, damit man nicht herausfinden kann, welche E-Mails existieren.
    return error("E-Mail oder Passwort stimmt nicht.", 401);
  }
  const cookie = await createSession(env, user.id);
  return json({ ok: true }, 200, { "Set-Cookie": cookie });
};

const logout: Handler = async (req, env) => {
  await destroySession(env, req);
  return json({ ok: true }, 200, { "Set-Cookie": clearCookie() });
};

const me: Handler = async (req, env) => {
  const userId = await requireUser(env, req);
  const row = await env.DB.prepare(
    `SELECT u.email, p.first_name, p.last_name, p.onboarding_done
     FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE u.id = ?`
  ).bind(userId).first();
  return json({ user: row });
};

// ---------- Profil ----------
const getProfile: Handler = async (req, env) => {
  const userId = await requireUser(env, req);
  const row = await env.DB.prepare("SELECT * FROM profiles WHERE user_id = ?").bind(userId).first();
  return json({ profile: row });
};

const updateProfile: Handler = async (req, env) => {
  const userId = await requireUser(env, req);
  const body = await readJson(req);
  const sets: string[] = [];
  const values: unknown[] = [];

  for (const [field, max] of Object.entries(PROFILE_FIELDS)) {
    if (field in body) {
      sets.push(`${field} = ?`); // Feldnamen stammen aus unserer festen Liste, nie vom Benutzer
      values.push(optText(body[field], max));
    }
  }
  if ("birthday" in body) {
    sets.push("birthday = ?");
    values.push(optDate(body.birthday));
  }
  if ("onboarding_done" in body) {
    sets.push("onboarding_done = ?");
    values.push(body.onboarding_done ? 1 : 0);
  }
  if (sets.length === 0) return error("Es wurden keine Änderungen gesendet.");

  sets.push("updated_at = datetime('now')");
  await env.DB.prepare(`UPDATE profiles SET ${sets.join(", ")} WHERE user_id = ?`)
    .bind(...values, userId)
    .run();
  return getProfile(req, env, new URLSearchParams());
};

// ---------- Konto: Export & Löschen ----------
const exportData: Handler = async (req, env) => {
  const userId = await requireUser(env, req);
  const user = await env.DB.prepare("SELECT email, created_at FROM users WHERE id = ?").bind(userId).first();
  const data: Record<string, unknown> = { exported_at: new Date().toISOString(), account: user };
  for (const table of USER_TABLES) {
    const { results } = await env.DB.prepare(`SELECT * FROM ${table} WHERE user_id = ?`).bind(userId).all();
    data[table] = results;
  }
  return json(data, 200, { "Content-Disposition": 'attachment; filename="mylife-export.json"' });
};

const deleteAccount: Handler = async (req, env) => {
  const userId = await requireUser(env, req);
  const body = await readJson(req);
  const password = typeof body.password === "string" ? body.password : "";
  const user = await env.DB.prepare("SELECT password_hash FROM users WHERE id = ?")
    .bind(userId)
    .first<{ password_hash: string }>();
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return error("Das Passwort stimmt nicht.", 403);
  }
  await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(userId).run(); // CASCADE löscht alles
  return json({ ok: true }, 200, { "Set-Cookie": clearCookie() });
};

// ---------- Router ----------
const routes: Record<string, Handler> = {
  "POST /api/auth/register": register,
  "POST /api/auth/login": login,
  "POST /api/auth/logout": logout,
  "GET /api/auth/me": me,
  "GET /api/profile": getProfile,
  "PUT /api/profile": updateProfile,
  "GET /api/account/export": exportData,
  "POST /api/account/delete": deleteAccount,
};

/** Schutz gegen CSRF: Änderungen nur von der eigenen Seite erlauben. */
function sameOrigin(req: Request): boolean {
  if (req.method === "GET" || req.method === "HEAD") return true;
  const origin = req.headers.get("Origin");
  if (!origin) return false;
  return new URL(origin).host === new URL(req.url).host;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(req);

    const handler = routes[`${req.method} ${url.pathname}`];
    if (!handler) return error("Diese Seite gibt es nicht.", 404);
    if (!sameOrigin(req)) return error("Anfrage nicht erlaubt.", 403);

    try {
      return await handler(req, env, url.searchParams);
    } catch (e) {
      if (e instanceof HttpError) return error(e.message, e.status);
      // Keine persönlichen Daten loggen – nur den Pfad und die Fehlerart.
      console.error("API-Fehler", url.pathname, e instanceof Error ? e.name : "unknown");
      return error("Etwas ist schiefgelaufen. Bitte versuche es später erneut.", 500);
    }
  },
} satisfies ExportedHandler<Env>;
