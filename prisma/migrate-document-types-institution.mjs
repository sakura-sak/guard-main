/**
 * One-time migration: attach document_types to institutions.
 * Runs BEFORE `prisma db push` — raw SQL only (generated client may be stale).
 *
 *   node prisma/migrate-document-types-institution.mjs
 */
import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

const DEFAULT_INSTITUTION_ID = "bsuir"

async function columnExists(table, column) {
  const rows = await prisma.$queryRaw`
    SELECT 1 AS ok
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = ${table}
      AND column_name = ${column}
    LIMIT 1
  `
  return Array.isArray(rows) && rows.length > 0
}

async function resolveDefaultInstitutionId() {
  const byId = await prisma.$queryRaw`
    SELECT id FROM institutions WHERE id = ${DEFAULT_INSTITUTION_ID} LIMIT 1
  `
  if (Array.isArray(byId) && byId.length > 0) return DEFAULT_INSTITUTION_ID

  const any = await prisma.$queryRaw`
    SELECT id FROM institutions WHERE is_active = true ORDER BY created_at ASC LIMIT 1
  `
  if (Array.isArray(any) && any.length > 0) return any[0].id

  return null
}

/** Drop legacy UNIQUE(name) so each institution can reuse slugs like "diploma". */
async function dropLegacyNameUnique() {
  await prisma.$executeRawUnsafe(`
    ALTER TABLE document_types DROP CONSTRAINT IF EXISTS document_types_name_key;
  `)

  const indexes = await prisma.$queryRaw`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'document_types'
  `

  for (const idx of indexes || []) {
    const def = String(idx.indexdef || "")
    if (!def.toUpperCase().includes("UNIQUE")) continue
    if (def.includes("institution_id")) continue
    if (/\(\s*name\s*\)/i.test(def)) {
      console.log(`Dropping legacy unique index ${idx.indexname}.`)
      await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "${idx.indexname}"`)
    }
  }
}

/** Remove duplicate rows per (institution_id, name), keep smallest id. */
async function dedupeDocumentTypes() {
  const removed = await prisma.$executeRaw`
    DELETE FROM document_types d
    USING document_types d2
    WHERE d.institution_id IS NOT NULL
      AND d2.institution_id IS NOT NULL
      AND d.institution_id = d2.institution_id
      AND d.name = d2.name
      AND d.id > d2.id
  `
  if (removed > 0) {
    console.log(`Removed ${removed} duplicate document_types row(s).`)
  }
}

async function main() {
  const tableExists = await prisma.$queryRaw`
    SELECT 1 AS ok
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'document_types'
    LIMIT 1
  `
  if (!Array.isArray(tableExists) || tableExists.length === 0) {
    console.log("Table document_types does not exist yet — skip migration.")
    return
  }

  const hasColumn = await columnExists("document_types", "institution_id")
  if (!hasColumn) {
    console.log("Adding institution_id to document_types…")
    await prisma.$executeRawUnsafe(`
      ALTER TABLE document_types
      ADD COLUMN IF NOT EXISTS institution_id TEXT;
    `)
  }

  const defaultInstId = await resolveDefaultInstitutionId()
  if (!defaultInstId) {
    console.warn("No institutions found — run seed after db push.")
  } else {
    const updated = await prisma.$executeRaw`
      UPDATE document_types
      SET institution_id = ${defaultInstId}
      WHERE institution_id IS NULL
    `
    console.log(`Backfilled institution_id=${defaultInstId} (rows updated: ${updated}).`)
  }

  await dedupeDocumentTypes()
  await dropLegacyNameUnique()

  console.log("Document types institution migration completed.")
  console.log("Next: npx prisma db push --accept-data-loss && npx prisma db seed")
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
