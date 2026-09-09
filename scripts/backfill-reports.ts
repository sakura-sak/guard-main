/**
 * Create `reports` rows for PDF spravki already stored under data/reports/.
 * Run once: npm run db:backfill-reports
 */

import { backfillReportsFromDisk } from "@/lib/local-storage"

async function main() {
  const result = await backfillReportsFromDisk()
  console.log(`Backfill reports: created=${result.created}, skipped=${result.skipped}`)
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
