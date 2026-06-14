CREATE TABLE users (
      username TEXT PRIMARY KEY,
      password TEXT NOT NULL,
      role TEXT NOT NULL,
      additional_roles_json TEXT,
      email TEXT,
      full_name TEXT,
      institution TEXT,
      created_at TEXT NOT NULL,
      last_login TEXT
    );
CREATE TABLE documents (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      author TEXT,
      filename TEXT,
      document_type TEXT,
      file_path TEXT,
      content TEXT NOT NULL,
      word_count INTEGER NOT NULL,
      upload_date TEXT NOT NULL,
      category TEXT NOT NULL,
      status TEXT NOT NULL,
      user_id TEXT,
      institution TEXT,
      minhash_signature_json TEXT NOT NULL,
      shingle_count INTEGER NOT NULL,
      originality_percent REAL,
      processing_time_ms INTEGER
    , plagiarism_percent_ml REAL, ai_percent_ml REAL);
CREATE INDEX idx_documents_upload_date ON documents(upload_date);
CREATE INDEX idx_documents_category ON documents(category);
CREATE INDEX idx_documents_user_id ON documents(user_id);
CREATE INDEX idx_documents_status ON documents(status);
CREATE INDEX idx_documents_institution ON documents(institution);
CREATE TABLE jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL,
      result_json TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      run_after_ms INTEGER,
      locked_by TEXT,
      locked_at_ms INTEGER
    );
CREATE TABLE sqlite_sequence(name,seq);
CREATE INDEX idx_jobs_status_run_after ON jobs(status, run_after_ms, id);
CREATE INDEX idx_jobs_locked_at ON jobs(locked_at_ms);
