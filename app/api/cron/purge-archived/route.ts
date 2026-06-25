import { type NextRequest, NextResponse } from "next/server"
import { purgeArchivedDocumentStorage } from "@/lib/local-storage"

function verifyCronSecret(request: NextRequest): boolean {
  const expected = process.env.CLEANUP_CRON_SECRET?.trim()
  if (!expected) return false
  const header =
    request.headers.get("x-cron-secret")?.trim() ||
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim()
  return Boolean(header && header === expected)
}

/** POST /api/cron/purge-archived — nightly job (cron / external scheduler). Header: X-Cron-Secret */
export async function POST(request: NextRequest) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }
  try {
    const result = await purgeArchivedDocumentStorage()
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    console.error("[cron/purge-archived] failed:", error)
    return NextResponse.json({ success: false, error: "Purge failed" }, { status: 500 })
  }
}
