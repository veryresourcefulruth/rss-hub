-- Terms of engagement and Key Information Document, signed in the hub.
-- Each published version is kept for ever so a signature can always be matched to the exact text signed.
CREATE TABLE agreement_versions (
  version INTEGER PRIMARY KEY,
  kid_md TEXT NOT NULL,
  terms_md TEXT NOT NULL,
  note TEXT,
  resign INTEGER NOT NULL DEFAULT 1,      -- 1 = everyone had to sign this version again
  published_by TEXT NOT NULL,
  published_at TEXT NOT NULL
);
CREATE TABLE signatures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  version INTEGER NOT NULL,
  kid_ack_at TEXT,          -- when they confirmed they had received the KID (must come before signing)
  signed_at TEXT,
  typed_name TEXT,
  ip TEXT,
  user_agent TEXT,
  kid_sha256 TEXT,
  terms_sha256 TEXT,
  UNIQUE (email, version)
);
CREATE INDEX signatures_email ON signatures(email);
