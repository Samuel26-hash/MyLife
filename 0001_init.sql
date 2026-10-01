-- MyLife – Datenbankschema (Cloudflare D1 / SQLite)
-- Jede Tabelle mit persönlichen Daten hat eine user_id.
-- Die API filtert IMMER nach user_id der eingeloggten Person.
-- ON DELETE CASCADE sorgt dafür, dass beim Löschen eines Kontos alle Daten mitgelöscht werden.

-- ===== Konto & Sicherheit =====
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Gespeichert wird nur der SHA-256-Hash des Session-Tokens, nie das Token selbst.
CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- Für Rate Limiting beim Login (nur fehlgeschlagene Versuche).
CREATE TABLE login_attempts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ip         TEXT NOT NULL,
  email      TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_login_attempts ON login_attempts(ip, created_at);

-- ===== Profil / Steckbrief =====
CREATE TABLE profiles (
  user_id         TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  first_name      TEXT,
  last_name       TEXT,
  avatar_key      TEXT,              -- Pfad in Cloudflare R2 (späterer Schritt)
  birthday        TEXT,              -- YYYY-MM-DD
  nationality     TEXT,
  city            TEXT,
  latitude        REAL,
  longitude       REAL,
  occupation      TEXT,              -- Schule / Ausbildung / Beruf
  interests       TEXT,
  hobbies         TEXT,
  favorite_sport  TEXT,
  strengths       TEXT,
  improve_areas   TEXT,
  goals_text      TEXT,
  onboarding_done INTEGER NOT NULL DEFAULT 0,
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ===== Schule & Noten (Schweizer System 1–6) =====
CREATE TABLE subjects (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  color      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_subjects_user ON subjects(user_id);

CREATE TABLE grades (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  value      REAL NOT NULL CHECK (value >= 1 AND value <= 6),
  weight     REAL NOT NULL DEFAULT 1,
  title      TEXT,
  date       TEXT NOT NULL
);
CREATE INDEX idx_grades_user ON grades(user_id, date);

-- ===== Ernährung =====
CREATE TABLE meals (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date       TEXT NOT NULL,
  meal_type  TEXT NOT NULL CHECK (meal_type IN ('fruehstueck','mittagessen','abendessen','snack','getraenk')),
  name       TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_meals_user ON meals(user_id, date);

CREATE TABLE nutrition_entries (
  id        TEXT PRIMARY KEY,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  meal_id   TEXT REFERENCES meals(id) ON DELETE CASCADE,
  date      TEXT NOT NULL,
  food_name TEXT NOT NULL,
  amount_g  REAL,
  calories  REAL,
  protein_g REAL,
  carbs_g   REAL,
  fat_g     REAL,
  fiber_g   REAL,
  sugar_g   REAL
);
CREATE INDEX idx_nutrition_user ON nutrition_entries(user_id, date);

CREATE TABLE water_entries (
  id        TEXT PRIMARY KEY,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date      TEXT NOT NULL,
  amount_ml INTEGER NOT NULL
);
CREATE INDEX idx_water_user ON water_entries(user_id, date);

CREATE TABLE nutrition_goals (
  user_id   TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  calories  REAL,
  protein_g REAL,
  water_ml  INTEGER
);

-- ===== Sport =====
CREATE TABLE sports (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE workouts (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sport_id     TEXT REFERENCES sports(id) ON DELETE SET NULL,
  date         TEXT NOT NULL,
  duration_min INTEGER,
  distance_km  REAL,
  performance  TEXT,
  notes        TEXT
);
CREATE INDEX idx_workouts_user ON workouts(user_id, date);

CREATE TABLE workout_exercises (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workout_id TEXT NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  sets       INTEGER,
  reps       INTEGER,
  weight_kg  REAL
);

CREATE TABLE football_matches (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,
  opponent    TEXT,
  position    TEXT,
  minutes     INTEGER,
  goals       INTEGER DEFAULT 0,
  assists     INTEGER DEFAULT 0,
  shots       INTEGER DEFAULT 0,
  dribbles_ok INTEGER DEFAULT 0,
  passes      INTEGER DEFAULT 0,
  ball_losses INTEGER DEFAULT 0,
  duels_won   INTEGER DEFAULT 0,
  duels_total INTEGER DEFAULT 0,
  rating      REAL CHECK (rating IS NULL OR (rating >= 1 AND rating <= 10)),
  notes       TEXT
);
CREATE INDEX idx_football_user ON football_matches(user_id, date);

-- ===== Finanzen (Beträge in Rappen, damit keine Rundungsfehler entstehen) =====
CREATE TABLE transactions (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date         TEXT NOT NULL,
  type         TEXT NOT NULL CHECK (type IN ('einnahme','ausgabe')),
  category     TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  note         TEXT
);
CREATE INDEX idx_transactions_user ON transactions(user_id, date);

CREATE TABLE savings_goals (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  target_cents INTEGER NOT NULL,
  saved_cents  INTEGER NOT NULL DEFAULT 0,
  due_date     TEXT
);

-- ===== Kalender =====
CREATE TABLE calendar_events (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  category     TEXT NOT NULL DEFAULT 'persoenlich',
  start_at     TEXT NOT NULL,
  end_at       TEXT,
  all_day      INTEGER NOT NULL DEFAULT 0,
  reminder_min INTEGER,
  notes        TEXT
);
CREATE INDEX idx_events_user ON calendar_events(user_id, start_at);

-- ===== Gewohnheiten =====
CREATE TABLE habits (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  times_per_day INTEGER NOT NULL DEFAULT 1,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE habit_entries (
  id       TEXT PRIMARY KEY,
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  habit_id TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
  date     TEXT NOT NULL,
  count    INTEGER NOT NULL DEFAULT 1,
  UNIQUE (habit_id, date)
);
CREATE INDEX idx_habit_entries_user ON habit_entries(user_id, date);

-- ===== Social Media =====
-- 1) Eigene Bildschirmzeit pro Plattform
CREATE TABLE social_media_usage (
  id       TEXT PRIMARY KEY,
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  date     TEXT NOT NULL,
  minutes  INTEGER NOT NULL CHECK (minutes >= 0)
);
CREATE INDEX idx_sm_usage_user ON social_media_usage(user_id, date);

-- 2) Eigene Accounts (z. B. TikTok @name)
CREATE TABLE social_accounts (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform   TEXT NOT NULL,
  handle     TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 3) Follower-/Abo-Entwicklung (ein Eintrag pro Tag/Woche)
CREATE TABLE social_account_stats (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id  TEXT NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,
  followers   INTEGER,
  following   INTEGER,
  posts_count INTEGER,
  UNIQUE (account_id, date)
);

-- 4) Einzelne Posts/Videos inkl. Inhalt und Zahlen.
-- Daraus berechnet die App später: beste Posting-Zeiten und Wochentage,
-- welche Themen/Formate am besten ankommen, ideale Videolänge usw.
CREATE TABLE social_posts (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id          TEXT NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
  posted_at           TEXT NOT NULL,     -- Datum + Uhrzeit (ISO), daraus Wochentag & Stunde
  format              TEXT,              -- video, reel, short, foto, karussell, story
  title               TEXT,
  topic               TEXT,              -- worüber war das Video? (z. B. Fussball, Vlog, Tutorial)
  content_description TEXT,              -- Inhalt kurz beschrieben
  hashtags            TEXT,
  sound               TEXT,
  duration_seconds    INTEGER,
  views               INTEGER,
  likes               INTEGER,
  comments            INTEGER,
  shares              INTEGER,
  saves               INTEGER,
  followers_gained    INTEGER,
  avg_watch_seconds   INTEGER,           -- falls die Plattform das anzeigt
  notes               TEXT,
  stats_updated_at    TEXT
);
CREATE INDEX idx_sm_posts_user ON social_posts(user_id, posted_at);

-- ===== Ziele & Erfolge =====
CREATE TABLE goals (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  category    TEXT NOT NULL,
  description TEXT,
  start_date  TEXT,
  due_date    TEXT,
  progress    INTEGER NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  status      TEXT NOT NULL DEFAULT 'aktiv' CHECK (status IN ('aktiv','erreicht','pausiert','abgebrochen')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_goals_user ON goals(user_id);

CREATE TABLE achievements (
  id        TEXT PRIMARY KEY,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key       TEXT NOT NULL,
  title     TEXT NOT NULL,
  earned_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, key)
);
