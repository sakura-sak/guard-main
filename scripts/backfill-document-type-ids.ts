/**
 * Fill documents.document_type_id from institution_id + category slug.
 * Run once after deploy: npm run db:backfill-document-types
 */

import { backfillDocumentTypeIds } from "@/lib/document-types"

async function main() {
  const result = await backfillDocumentTypeIds()
  console.log(`Backfill complete: updated=${result.updated}, skipped=${result.skipped}`)
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
