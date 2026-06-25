-- Author is derived from documents.user_id → users.full_name (no duplicate column).
ALTER TABLE documents DROP COLUMN IF EXISTS author;
