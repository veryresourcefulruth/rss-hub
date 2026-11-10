-- Weekly availability. Staff say, day by day, when they can work; RSS sees it when filling shifts.
-- slot: none = not available, all = any time that day, am = mornings, pm = afternoons, times = between start and finish.
CREATE TABLE IF NOT EXISTS availability (
  email TEXT NOT NULL,
  date TEXT NOT NULL,
  slot TEXT NOT NULL CHECK (slot IN ('none','all','am','pm','times')),
  start TEXT,
  finish TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (email, date)
);
CREATE INDEX IF NOT EXISTS availability_date ON availability(date);
-- One row per person per week (Monday date) once they have sent that week's availability.
CREATE TABLE IF NOT EXISTS availability_weeks (
  email TEXT NOT NULL,
  week_start TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  late INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (email, week_start)
);
