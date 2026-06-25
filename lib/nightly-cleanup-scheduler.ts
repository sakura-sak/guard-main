import { purgeArchivedDocumentStorage } from "@/lib/local-storage"

function msUntilNextLocalTime(hour: number, minute: number): number {
  const now = new Date()
  const next = new Date(now)
  next.setHours(hour, minute, 0, 0)
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1)
  }
  return next.getTime() - now.getTime()
}

let started = false

/** Runs purgeArchivedDocumentStorage once per day at ARCHIVE_PURGE_HOUR:ARCHIVE_PURGE_MINUTE (local server time). */
export function startNightlyArchivePurgeScheduler(): void {
  if (started) return
  if (process.env.ARCHIVE_PURGE_ENABLED === "false") return
  started = true

  const hour = Number.parseInt(process.env.ARCHIVE_PURGE_HOUR || "3", 10)
  const minute = Number.parseInt(process.env.ARCHIVE_PURGE_MINUTE || "0", 10)
  const safeHour = Number.isFinite(hour) ? Math.min(23, Math.max(0, hour)) : 3
  const safeMinute = Number.isFinite(minute) ? Math.min(59, Math.max(0, minute)) : 0

  const run = async () => {
    try {
      const result = await purgeArchivedDocumentStorage()
      console.log(
        `[nightly-cleanup] archived storage purge: ${result.purged} docs, ${result.filesDeleted} upload files, ${result.reportsDeleted} report PDFs`,
      )
    } catch (err) {
      console.error("[nightly-cleanup] archived storage purge failed:", err)
    }
  }

  const scheduleNext = () => {
    const delay = msUntilNextLocalTime(safeHour, safeMinute)
    setTimeout(() => {
      void run().finally(scheduleNext)
    }, delay)
  }

  scheduleNext()
  console.log(
    `[nightly-cleanup] scheduled daily archive purge at ${String(safeHour).padStart(2, "0")}:${String(safeMinute).padStart(2, "0")} (server local time)`,
  )
}
