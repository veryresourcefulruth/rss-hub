-- Arrival and departure: signed in at the nursery's sign-in station (manager's iPad) or on the worker's own phone.
ALTER TABLE shifts ADD COLUMN clock_in_at TEXT;
ALTER TABLE shifts ADD COLUMN clock_out_at TEXT;
ALTER TABLE shifts ADD COLUMN clock_in_by TEXT;     -- 'pin' | 'manager' | 'phone' | 'office'
ALTER TABLE shifts ADD COLUMN clock_out_by TEXT;
ALTER TABLE shifts ADD COLUMN clock_note TEXT;      -- e.g. how far the phone was from the nursery
ALTER TABLE clients ADD COLUMN lat REAL;            -- where the nursery is, for the phone check
ALTER TABLE clients ADD COLUMN lng REAL;
CREATE TABLE station_pins (email TEXT PRIMARY KEY, hash TEXT NOT NULL, set_at TEXT NOT NULL);
CREATE TABLE pin_fails (email TEXT NOT NULL, at TEXT NOT NULL);
CREATE INDEX pin_fails_email ON pin_fails(email, at);
