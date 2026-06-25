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
