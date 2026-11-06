-- Childcare 101 now lives in the Hub: progress is tied to each person's email instead of a typed name.
CREATE TABLE training_status (
  email TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  declared_at TEXT,
  last_seen_at TEXT,
  legacy_trainee_id TEXT UNIQUE      -- the old training app's record this progress was carried over from
);
CREATE TABLE training_results (
  email TEXT NOT NULL,
  module_id TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  best INTEGER NOT NULL DEFAULT 0,
  passed INTEGER NOT NULL DEFAULT 0,
  passed_at TEXT,
  last_at TEXT,
  PRIMARY KEY (email, module_id)
);
