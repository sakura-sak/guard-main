-- Unused: auth uses signed cookies; notifications and job queue were never wired to the UI.
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS jobs;
