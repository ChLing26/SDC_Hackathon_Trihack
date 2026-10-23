-- Remove legacy Tools secret values and audit history without changing other data.
DROP TABLE IF EXISTS tools_secret_events;
DROP TABLE IF EXISTS tools_secrets;
