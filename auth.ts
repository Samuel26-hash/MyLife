// Passwort-Hashing (PBKDF2) und Sessions mit sicheren HttpOnly-Cookies.
import { HttpError } from "./http";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

const ITERATIONS = 100_000; // Maximum, das Cloudflare Workers für PBKDF2 erlaubt
const SESSION_DAYS = 30;
export const COOKIE_NAME = "mylife_session";

const enc = new TextEncoder();

function toB64(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s);
}
function fromB64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}
function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${toB64(salt)}$${toB64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, iter, saltB64, hashB64] = stored.split("$");
  if (algo !== "pbkdf2" || !iter || !saltB64 || !hashB64) return false;
  const actual = new Uint8Array(await pbkdf2(password, fromB64(saltB64), Number(iter)));
  const expected = fromB64(hashB64);
  if (actual.length !== expected.length) return false;
  let diff = 0; // Vergleich in konstanter Zeit
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

async function sha256Hex(text: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", enc.encode(text)));
}

export function newId(): string {
  return crypto.randomUUID();
}

/** Erstellt eine Session und gibt den Set-Cookie-Header zurück. */
export async function createSession(env: Env, userId: string): Promise<string> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = toB64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await env.DB.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(await sha256Hex(token), userId, expires.toISOString())
    .run();
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
}

export function clearCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function readCookie(request: Request): string | null {
  const header = request.headers.get("Cookie") ?? "";
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE_NAME) return rest.join("=") || null;
  }
  return null;
}

/** Gibt die user_id der eingeloggten Person zurück oder null. */
export async function getUserId(env: Env, request: Request): Promise<string | null> {
  const token = readCookie(request);
  if (!token) return null;
  const row = await env.DB.prepare("SELECT user_id, expires_at FROM sessions WHERE id = ?")
    .bind(await sha256Hex(token))
    .first<{ user_id: string; expires_at: string }>();
  if (!row) return null;
  if (Date.parse(row.expires_at) < Date.now()) {
    await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(await sha256Hex(token)).run();
    return null;
  }
  return row.user_id;
}

export async function requireUser(env: Env, request: Request): Promise<string> {
  const id = await getUserId(env, request);
  if (!id) throw new HttpError(401, "Bitte melde dich an.");
  return id;
}

export async function destroySession(env: Env, request: Request): Promise<void> {
  const token = readCookie(request);
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(await sha256Hex(token)).run();
}

// ----- Rate Limiting für den Login -----
const MAX_FAILED = 8;
const WINDOW_MIN = 15;

export function clientIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? "unbekannt";
}

export async function checkLoginRateLimit(env: Env, ip: string, email: string): Promise<void> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM login_attempts
     WHERE (ip = ? OR email = ?) AND created_at > datetime('now', ?)`
  )
    .bind(ip, email.toLowerCase(), `-${WINDOW_MIN} minutes`)
    .first<{ n: number }>();
  if ((row?.n ?? 0) >= MAX_FAILED) {
    throw new HttpError(429, `Zu viele Versuche. Bitte warte ${WINDOW_MIN} Minuten und versuche es dann erneut.`);
  }
}

export async function recordFailedLogin(env: Env, ip: string, email: string): Promise<void> {
  await env.DB.prepare("INSERT INTO login_attempts (ip, email) VALUES (?, ?)")
    .bind(ip, email.toLowerCase())
    .run();
  // Alte Einträge aufräumen
  await env.DB.prepare("DELETE FROM login_attempts WHERE created_at < datetime('now', '-1 day')").run();
}
