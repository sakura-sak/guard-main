import { getSqlite, getSqlitePath } from "../lib/sqlite"
import { ensureSqliteSeededFromLocalJson } from "../lib/sqlite-seed"

function main() {
  const db = getSqlite()
  ensureSqliteSeededFromLocalJson()
  const tables = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
    )
    .all() as Array<{ name: string }>

  // eslint-disable-next-line no-console
  console.log(`SQLite path: ${getSqlitePath()}`)
  // eslint-disable-next-line no-console
  console.log(`Tables: ${tables.map((t) => t.name).join(", ") || "(none)"}`)
}

main()

