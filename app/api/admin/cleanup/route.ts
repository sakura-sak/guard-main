import { type NextRequest, NextResponse } from "next/server"
import { cleanupArchivedRecords } from "@/lib/local-storage"
import { requireAdminApi } from "@/lib/require-admin-api"

/** POST /api/admin/cleanup — ночная очистка archived записей (вызывать cron-ом) */
export async function POST(request: NextRequest) {
  const gate = await requireAdminApi(request)
  if (!gate.ok) return gate.response
  const removed = await cleanupArchivedRecords()
  return NextResponse.json({ success: true, removed })
}
