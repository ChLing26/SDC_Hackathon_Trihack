CREATE TABLE IF NOT EXISTS tools_secrets (
  name text PRIMARY KEY CHECK (name ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  encrypted_value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by integer REFERENCES accounts(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS tools_secret_events (
  id serial PRIMARY KEY,
  secret_name text NOT NULL,
  action text NOT NULL CHECK (action IN ('create', 'replace', 'delete')),
  actor_id integer REFERENCES accounts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
