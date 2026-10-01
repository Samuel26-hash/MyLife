// Kleine Hilfsfunktionen für Antworten und Validierung.

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}

/** Benutzerfreundlicher Fehler – ohne technische Details. */
export function error(message: string, status = 400): Response {
  return json({ error: message }, status);
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  const type = request.headers.get("Content-Type") ?? "";
  if (!type.includes("application/json")) throw new HttpError(415, "Ungültige Anfrage.");
  const text = await request.text();
  if (text.length > 50_000) throw new HttpError(413, "Die Anfrage ist zu gross.");
  try {
    const data = JSON.parse(text);
    if (typeof data !== "object" || data === null || Array.isArray(data)) throw new Error();
    return data as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "Ungültige Anfrage.");
  }
}

/** Optionaler Text, gekürzt und bereinigt. Leerer Text wird zu null. */
export function optText(value: unknown, max = 500): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new HttpError(400, "Ungültige Eingabe.");
  const trimmed = value.trim();
  if (trimmed.length > max) throw new HttpError(400, `Ein Feld ist zu lang (max. ${max} Zeichen).`);
  return trimmed === "" ? null : trimmed;
}

export function optDate(value: unknown): string | null {
  const text = optText(value, 10);
  if (text === null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(text))) {
    throw new HttpError(400, "Bitte gib ein gültiges Datum ein.");
  }
  return text;
}

export function isValidEmail(email: string): boolean {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}
