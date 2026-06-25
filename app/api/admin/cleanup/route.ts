import { type NextRequest, NextResponse } from "next/server"
import { purgeArchivedDocumentStorage } from "@/lib/local-storage"
import { requireAdminApi } from "@/lib/require-admin-api"

/** POST /api/admin/cleanup — удалить файлы и текст архивных работ (статистика в БД сохраняется) */
export async function POST(request: NextRequest) {
  const gate = await requireAdminApi(request)
  if (!gate.ok) return gate.response
  const result = await purgeArchivedDocumentStorage()
  return NextResponse.json({ success: true, ...result, removed: result.purged })
}
