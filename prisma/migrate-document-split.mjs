/**
 * One-time migration: move documents.content + minhash_signature_json → child tables.
 * Run before `prisma db push` on existing databases.
 *
 *   node prisma/migrate-document-split.mjs
 */
import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

async function columnExists(table, column) {
  const rows = await prisma.$queryRaw`
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = ${table}
      AND column_name = ${column}
    LIMIT 1
  `
  return Array.isArray(rows) && rows.length > 0
}

async function tableExists(table) {
  const rows = await prisma.$queryRaw`
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = ${table}
    LIMIT 1
  `
  return Array.isArray(rows) && rows.length > 0
}

async function main() {
  const hasLegacyContent = await columnExists("documents", "content")
  const hasContentsTable = await tableExists("document_contents")

  if (!hasLegacyContent) {
    if (hasContentsTable) {
      console.log("migrate-document-split: already applied (no legacy columns).")
    } else {
      console.log("migrate-document-split: fresh schema — nothing to migrate.")
    }
    return
  }

  console.log("migrate-document-split: moving content and signatures to child tables…")

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS document_contents (
      document_id INTEGER PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
      text TEXT NOT NULL DEFAULT '',
      extracted_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `)

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS document_signatures (
      document_id INTEGER PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
      minhash INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
      shingle_count INTEGER NOT NULL DEFAULT 0,
      computed_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `)

  await prisma.$executeRawUnsafe(`
    INSERT INTO document_contents (document_id, text)
    SELECT d.id, COALESCE(d.content, '')
    FROM documents d
    WHERE NOT EXISTS (
      SELECT 1 FROM document_contents c WHERE c.document_id = d.id
    );
  `)

  await prisma.$executeRawUnsafe(`
    INSERT INTO document_signatures (document_id, minhash, shingle_count)
    SELECT
      d.id,
      CASE
        WHEN d.minhash_signature_json IS NULL
          OR TRIM(d.minhash_signature_json) = ''
          OR TRIM(d.minhash_signature_json) = '[]'
          OR TRIM(d.minhash_signature_json) = 'null'
        THEN ARRAY[]::INTEGER[]
        ELSE COALESCE(
          (
            SELECT array_agg(val::INTEGER)
            FROM json_array_elements_text(d.minhash_signature_json::json) AS val
          ),
          ARRAY[]::INTEGER[]
        )
      END,
      COALESCE(d.shingle_count, 0)
    FROM documents d
    WHERE NOT EXISTS (
      SELECT 1 FROM document_signatures s WHERE s.document_id = d.id
    );
  `)

  await prisma.$executeRawUnsafe(`ALTER TABLE documents DROP COLUMN IF EXISTS content;`)
  await prisma.$executeRawUnsafe(`ALTER TABLE documents DROP COLUMN IF EXISTS minhash_signature_json;`)
  await prisma.$executeRawUnsafe(`ALTER TABLE documents DROP COLUMN IF EXISTS shingle_count;`)

  console.log("migrate-document-split: done.")
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
