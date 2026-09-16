import { type NextRequest, NextResponse } from "next/server"
import { getDocumentAnalysisState } from "@/lib/analysis-jobs"
import { requireSessionOrMoodleApi } from "@/lib/require-moodle-api"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> },
) {
  const gate = await requireSessionOrMoodleApi(request)
  if (!gate.ok) return gate.response

  const { documentId } = await params
  const id = parseInt(documentId, 10)
  if (Number.isNaN(id)) {
    return NextResponse.json({ success: false, error: "Некорректный ID" }, { status: 400 })
  }

  const isAdmin = gate.user.role === "admin" || gate.user.role === "superadmin"
  const state = await getDocumentAnalysisState(id, gate.user.username)
  if (!state && !isAdmin) {
    return NextResponse.json({ success: false, error: "Документ не найден" }, { status: 404 })
  }

  if (!state && isAdmin) {
    // Admins may inspect any document's analysis state
    const { prisma } = await import("@/lib/prisma")
    const doc = await prisma.document.findUnique({
      where: { id },
      include: { analysisJob: true },
    })
    if (!doc) {
      return NextResponse.json({ success: false, error: "Документ не найден" }, { status: 404 })
    }
    return NextResponse.json({
      success: true,
      documentId: doc.id,
      jobId: doc.analysisJob?.id ?? null,
      jobStatus: doc.analysisJob?.status ?? null,
      documentStatus: doc.status,
      title: doc.title,
      filename: doc.filename,
      category: doc.category,
      wordCount: doc.wordCount,
      localPlagiarismPercent: doc.localPlagiarismPercent,
      originalityPercent: doc.originalityPercent,
      plagiarismPercentMl: doc.plagiarismPercentMl,
      aiPercentMl: doc.aiPercentMl,
      processingTimeMs: doc.processingTimeMs,
      analysisCompletedAt: doc.analysisCompletedAt,
      resultViewedAt: doc.resultViewedAt,
      expiresAt: doc.expiresAt,
      lastError: doc.analysisJob?.lastError ?? null,
      attempts: doc.analysisJob?.attempts ?? 0,
    })
  }

  return NextResponse.json({ success: true, ...state })
}
