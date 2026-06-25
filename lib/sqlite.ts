import fs from "fs"
import path from "path"
import Database from "better-sqlite3"

export type SqliteDb = Database.Database

const DATA_DIR = path.join(process.cwd(), "data")
const SQLITE_PATH = process.env.SQLITE_PATH
  ? path.resolve(process.env.SQLITE_PATH)
  : path.join(DATA_DIR, "app.db")

let _db: SqliteDb | null = null

export function getSqlitePath(): string {
  return SQLITE_PATH
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
}

function pragma(db: SqliteDb, sql: string) {
  db.pragma(sql)
}

export function getSqlite(): SqliteDb {
  if (_db) return _db

  ensureDataDir()
  const db = new Database(SQLITE_PATH)

  // Safer defaults for concurrent reads in Next dev/server
  pragma(db, "journal_mode = WAL")
  pragma(db, "synchronous = NORMAL")
  pragma(db, "foreign_keys = ON")
  pragma(db, "busy_timeout = 5000")

  migrate(db)
  _db = db
  return db
}

function tableHasColumn(db: SqliteDb, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  return rows.some((r) => r.name === column)
}

export function migrate(db: SqliteDb) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
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

    CREATE TABLE IF NOT EXISTS documents (
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
    );

    CREATE INDEX IF NOT EXISTS idx_documents_upload_date ON documents(upload_date);
    CREATE INDEX IF NOT EXISTS idx_documents_category ON documents(category);
    CREATE INDEX IF NOT EXISTS idx_documents_user_id ON documents(user_id);
    CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);
    CREATE INDEX IF NOT EXISTS idx_documents_institution ON documents(institution);
  `)

  if (!tableHasColumn(db, "documents", "plagiarism_percent_ml")) {
    db.exec(`ALTER TABLE documents ADD COLUMN plagiarism_percent_ml REAL`)
  }
  if (!tableHasColumn(db, "documents", "ai_percent_ml")) {
    db.exec(`ALTER TABLE documents ADD COLUMN ai_percent_ml REAL`)
  }
  if (!tableHasColumn(db, "documents", "document_type")) {
    db.exec(`ALTER TABLE documents ADD COLUMN document_type TEXT`)
  }
  if (!tableHasColumn(db, "documents", "processing_time_ms")) {
    db.exec(`ALTER TABLE documents ADD COLUMN processing_time_ms INTEGER`)
  }
}

