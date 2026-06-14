import { type NextRequest, NextResponse } from "next/server"
import { getStorageStats } from "@/lib/local-storage"
import { requireAdminApi } from "@/lib/require-admin-api"

export async function GET(request: NextRequest) {
  const gate = await requireAdminApi(request)
  if (!gate.ok) return gate.response
  const stats = await getStorageStats()
  return NextResponse.json({ success: true, stats })
}
