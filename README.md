# MyLife

**Dein Leben. Deine Ziele. Deine Entwicklung.**
Created by Lenny Luvuezo

MyLife ist ein persönliches Life-Dashboard: Schule, Sport, Ernährung, Finanzen, Gewohnheiten, Social Media und Ziele an einem Ort.

## Stand dieser Version (Schritt 1)

Fertig und funktionsfähig:

- Landingpage mit Designsystem (Gelb/Gold, Anthrazit, Grün/Orange/Rot für Status)
- Registrierung, Login, Logout mit echten, sicheren Sessions
- Einrichtungsassistent nach der Registrierung (3 Schritte, alles freiwillig)
- Profil / Steckbrief anzeigen und bearbeiten
- Dashboard mit leeren Zuständen (es werden nie erfundene Zahlen angezeigt)
- Navigation: Sidebar auf Desktop, untere Leiste + „Mehr“-Menü auf dem Handy
- Einstellungen: Daten exportieren (JSON), Abmelden, Konto löschen
- Vollständiges Datenbankschema für **alle** geplanten Module (inkl. Social-Media-Auswertung)

Die übrigen Module (Schule, Ziele, Kalender, Sport, Ernährung, Finanzen, Gewohnheiten, Social Media, Wetter, Entwicklung) zeigen vorerst eine Seite mit dem, was dort geplant ist. Sie werden Schritt für Schritt gebaut.

## Technik

| Teil | Technologie |
|---|---|
| Frontend | React 19 + TypeScript + Vite |
| Styling | Tailwind CSS 4 |
| Backend/API | Cloudflare Worker (`worker/`) |
| Datenbank | Cloudflare D1 (SQLite) |
| Hosting | Ein einziger Cloudflare Worker liefert App und API aus |
| Code | GitHub |

## Projektstruktur

```
mylife/
├── migrations/          Datenbank-Migrationen (SQL)
├── worker/              Backend: API, Login, Sessions
│   ├── index.ts         Router und API-Endpunkte
│   ├── auth.ts          Passwort-Hashing, Sessions, Rate Limiting
│   └── http.ts          Antworten und Eingabe-Validierung
├── src/                 Frontend
│   ├── components/      Wiederverwendbare Bausteine (Button, Card, ProgressBar, Layout …)
│   ├── pages/           Seiten (Landing, Login, Dashboard, Profil …)
│   └── lib/             API-Client, Login-Status, Modul-Liste
├── wrangler.jsonc       Cloudflare-Konfiguration
└── .dev.vars.example    Vorlage für geheime Schlüssel
```

---

## 1. Lokal starten

Voraussetzung: [Node.js](https://nodejs.org) Version 20 oder neuer.

```bash
npm install
```

Lokale Datenbank einrichten (einmalig, siehe Punkt 2):

```bash
npm run db:migrate:local
```

Dann **zwei Terminals** öffnen:

```bash
# Terminal 1: API (Cloudflare Worker lokal)
npm run build        # einmalig, damit der Ordner dist existiert
npm run dev:api

# Terminal 2: Frontend mit Live-Reload
npm run dev
```

Öffne http://localhost:5173. Tipp: Für die lokale Entwicklung Chrome oder Firefox verwenden (Safari akzeptiert sichere Cookies auf `localhost` teilweise nicht).

## 2. Datenbank einrichten

```bash
npx wrangler login
npx wrangler d1 create mylife-db
```

Der zweite Befehl gibt eine `database_id` aus. Kopiere sie in `wrangler.jsonc` an die Stelle `HIER-DEINE-DATABASE-ID-EINSETZEN`.

Tabellen anlegen:

```bash
npm run db:migrate:local    # für die lokale Entwicklung
npm run db:migrate:remote   # für die echte Datenbank bei Cloudflare
```

Neue Tabellen oder Änderungen kommen später als neue Datei in `migrations/` (z. B. `0002_...sql`). Bestehende Migrationen nie nachträglich ändern.

## 3. Mit GitHub verbinden

1. Auf GitHub ein neues, **privates** Repository `mylife` erstellen (ohne README).
2. Im Projektordner:

```bash
git init
git add .
git commit -m "MyLife: Grundgerüst, Login, Profil"
git branch -M main
git remote add origin https://github.com/DEIN-NAME/mylife.git
git push -u origin main
```

Die Datei `.gitignore` sorgt dafür, dass `node_modules`, `dist` und geheime Dateien wie `.dev.vars` **nicht** hochgeladen werden.

## 4. Auf Cloudflare deployen

**Variante A – direkt vom Computer:**

```bash
npm run db:migrate:remote
npm run deploy
```

Danach ist die App unter `https://mylife.<dein-name>.workers.dev` erreichbar.

**Variante B – automatisch bei jedem Push auf GitHub:**

1. Cloudflare Dashboard → *Workers & Pages* → *Create* → *Import a repository*.
2. GitHub verbinden und das Repository `mylife` wählen.
3. Build command: `npm run build`, Deploy command: `npx wrangler deploy`.
4. Ab jetzt wird jede Änderung auf `main` automatisch veröffentlicht.

Wichtig: Datenbank-Migrationen laufen nicht automatisch. Nach neuen Migrationen einmal `npm run db:migrate:remote` ausführen.

## 5. API-Keys

Für diese Version wird **kein** API-Key benötigt.

Später:

| Funktion | Möglicher Dienst | Key nötig? |
|---|---|---|
| Wetter | [Open-Meteo](https://open-meteo.com) | Nein (für nicht-kommerzielle Nutzung) |
| Wetter (Alternative) | OpenWeatherMap | Ja, `WEATHER_API_KEY` |
| Passwort vergessen (E-Mail) | z. B. Resend | Ja, `EMAIL_API_KEY` |

## 6. Umgebungsvariablen

Lokal: `.dev.vars.example` zu `.dev.vars` kopieren und ausfüllen.
Produktion: Secrets nie in den Code schreiben, sondern so setzen:

```bash
npx wrangler secret put WEATHER_API_KEY
```

| Variable | Wofür | Ab wann |
|---|---|---|
| `WEATHER_API_KEY` | Wetter-API (nur bei OpenWeatherMap) | Wetter-Modul |
| `EMAIL_API_KEY` | E-Mails für „Passwort vergessen“ | Passwort-Reset |
| `EMAIL_FROM` | Absenderadresse | Passwort-Reset |

Die Datenbank ist keine Variable, sondern in `wrangler.jsonc` als `DB` eingebunden.

---

## Sicherheit

- Passwörter werden mit PBKDF2-SHA256 (100 000 Durchläufe, zufälliges Salt) gehasht, nie im Klartext gespeichert.
- Sessions: zufälliges 256-Bit-Token im `HttpOnly`/`Secure`/`SameSite=Lax`-Cookie; in der Datenbank liegt nur der SHA-256-Hash.
- Jede Abfrage filtert nach der `user_id` der eingeloggten Person. Niemand sieht fremde Daten.
- Alle SQL-Abfragen nutzen Platzhalter (`?`) → Schutz vor SQL Injection.
- React escaped Ausgaben automatisch → Schutz vor XSS.
- CSRF-Schutz: Änderungen werden nur akzeptiert, wenn der `Origin`-Header zur eigenen Seite passt.
- Rate Limiting: nach 8 Fehlversuchen in 15 Minuten wird der Login gesperrt.
- Eingaben werden im Backend geprüft (Länge, Datum, E-Mail).
- Logs enthalten keine persönlichen Daten.
- Konto löschen entfernt per `ON DELETE CASCADE` alle Daten; Export liefert alle Daten als JSON.

## Hinweis zum Social-Media-Modul

Das Schema speichert pro Account die Follower-Entwicklung und pro Post: Datum und Uhrzeit, Format, Thema, Inhalt, Hashtags, Sound, Videolänge, Views, Likes, Kommentare, Shares, Saves und neue Follower. Daraus berechnet das Modul später die besten Posting-Zeiten, Wochentage, Themen und Videolängen.

In der ersten Version werden die Zahlen **manuell** eingetragen (sie stehen in den Statistiken der jeweiligen App). Ein automatischer Import ist nur über die offiziellen Schnittstellen möglich, z. B. die Instagram Graph API (braucht ein Business- oder Creator-Konto) oder die TikTok Display API (braucht eine Freigabe durch TikTok). Das kann später als eigener Schritt ergänzt werden.

## Nächste Schritte (Reihenfolge)

1. ~~Landingpage, Designsystem, Login, Profil, Dashboard~~
2. Schule & Noten
3. Ziele
4. Kalender
5. Sport + Fussball-Modul
6. Ernährung
7. Finanzen
8. Gewohnheiten
9. Social Media (Bildschirmzeit + Account-Auswertung)
10. Meine Entwicklung
11. Wetter
12. Passwort vergessen, Profilbild-Upload (Cloudflare R2), Demo-Modus
