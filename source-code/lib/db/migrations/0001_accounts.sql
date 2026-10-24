-- Additive and repeatable: the shared procurement dataset is not touched.
CREATE TABLE IF NOT EXISTS accounts (
  id serial PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT accounts_email_normalized CHECK (email = lower(trim(email)))
);
CREATE TABLE IF NOT EXISTS account_sessions (
  token_hash text PRIMARY KEY,
  account_id integer NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS account_sessions_expiry_idx ON account_sessions(expires_at);
CREATE TABLE IF NOT EXISTS auth_attempts (
  key text PRIMARY KEY,
  count integer NOT NULL,
  resets_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_attempts_reset_idx ON auth_attempts(resets_at);
