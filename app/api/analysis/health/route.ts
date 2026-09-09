import { type NextRequest, NextResponse } from "next/server"
import { getAnalysisQueueStats } from "@/lib/analysis-jobs"

/**
 * Lightweight worker/queue health for ops (secret-protected like cleanup cron).
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CLEANUP_CRON_SECRET?.trim()
  const provided =
    request.headers.get("x-cron-secret")?.trim() ||
    request.nextUrl.searchParams.get("secret")?.trim() ||
    ""
  if (secret && provided !== secret) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }

  const stats = await getAnalysisQueueStats()
  return NextResponse.json({
    success: true,
    ok: true,
    ...stats,
    ts: new Date().toISOString(),
  })
}
