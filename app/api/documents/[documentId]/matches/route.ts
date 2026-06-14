import { type NextRequest, NextResponse } from "next/server"
import { getDocumentByIdFromDb } from "@/lib/local-storage"
import { findMatchingFragments } from "@/lib/plagiarism/algorithms"
import { getSimilarDocumentsForReport } from "@/lib/similar-documents-for-report"
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

  const similarDocs = await getSimilarDocumentsForReport(id)
  const fragments: Array<{
    text: string
    sourceTitle: string
    sourceId: number
    similarity: number
    type: "borrow" | "ai"
  }> = []

  for (const sim of similarDocs.slice(0, 5)) {
    const source = await getDocumentByIdFromDb(sim.id)
    if (!source?.content) continue
    const matches = findMatchingFragments(doc.content, source.content, 5)
    for (const m of matches.slice(0, 3)) {
      fragments.push({
        text: m.text,
        sourceTitle: sim.title,
        sourceId: sim.id,
        similarity: sim.similarity,
        type: "borrow",
      })
    }
  }

  const aiPercent = doc.aiPercentMl ?? 0
  if (aiPercent > 0 && doc.content.length > 200) {
    const chunk = doc.content.slice(0, 500)
    fragments.push({
      text: chunk,
      sourceTitle: "AI-детектор",
      sourceId: 0,
      similarity: aiPercent,
      type: "ai",
    })
  }

  return NextResponse.json({
    success: true,
    similarDocuments: similarDocs,
    fragments,
    aiPercent: doc.aiPercentMl,
    plagiarismPercent: doc.plagiarismPercentMl,
    originalityPercent: doc.originalityPercent,
  })
}
