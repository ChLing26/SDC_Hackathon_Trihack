-- Bootstrap only when absent. Never replace or reseed existing shared records.
CREATE TABLE IF NOT EXISTS procurement_records (
  id serial PRIMARY KEY,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
