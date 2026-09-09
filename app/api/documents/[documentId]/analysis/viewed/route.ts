import { type NextRequest, NextResponse } from "next/server"
import { markAnalysisResultViewed } from "@/lib/analysis-jobs"
import { requireSessionApi } from "@/lib/require-session-api"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> },
) {
  const gate = await requireSessionApi(request)
  if (!gate.ok) return gate.response

  const { documentId } = await params
  const id = parseInt(documentId, 10)
  if (Number.isNaN(id)) {
    return NextResponse.json({ success: false, error: "Некорректный ID" }, { status: 400 })
  }

  const ok = await markAnalysisResultViewed(id, gate.user.username)
  if (!ok) {
    return NextResponse.json({ success: false, error: "Документ не найден" }, { status: 404 })
  }
  return NextResponse.json({ success: true })
}
