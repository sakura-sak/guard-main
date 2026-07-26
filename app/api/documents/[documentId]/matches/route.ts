import { type NextRequest, NextResponse } from "next/server"
import { getDocumentByIdFromDb } from "@/lib/local-storage"
import { getDocumentMatchesData } from "@/lib/document-matches-data"
import { logInfo } from "@/lib/logger"
import { requireSessionApi } from "@/lib/require-session-api"

export async function GET(
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

  const doc = await getDocumentByIdFromDb(id)
  if (!doc) {
    return NextResponse.json({ success: false, error: "Документ не найден" }, { status: 404 })
  }

  const isOwner = doc.userId === gate.user.username
  const isAdmin = gate.user.role === "admin" || gate.user.role === "superadmin"
  if (!isOwner && !isAdmin) {
    return NextResponse.json({ success: false, error: "Нет доступа" }, { status: 403 })
  }

  const payload = await getDocumentMatchesData(id)
  if (!payload) {
    return NextResponse.json({ success: false, error: "Документ не найден" }, { status: 404 })
  }

  logInfo("Заимствования рассчитаны для документа", gate.user.username, gate.user.role, "document_matches", {
    documentId: id,
    category: doc.category,
    institutionId: doc.institutionId ?? null,
    borrowMatchCount: payload.borrowMatches.length,
    fragmentCount: payload.fragments.filter((f) => f.type === "borrow").length,
    localPlagiarismPercent: payload.localPlagiarismPercent,
    mlPlagiarismPercent: payload.mlPlagiarismPercent,
    plagiarismPercent: payload.plagiarismPercent,
    topCandidates: payload.similarDocuments.slice(0, 5),
  })

  return NextResponse.json({
    success: true,
    similarDocuments: payload.similarDocuments,
    fragments: payload.fragments,
    borrowMatches: payload.borrowMatches,
    aiMatches: payload.aiMatches,
    aiPercent: payload.aiPercent,
    localPlagiarismPercent: payload.localPlagiarismPercent,
    mlPlagiarismPercent: payload.mlPlagiarismPercent,
    plagiarismPercent: payload.plagiarismPercent,
    originalityPercent: payload.originalityPercent,
  })
}
