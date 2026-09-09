import { type NextRequest, NextResponse } from "next/server"
import { getDocumentByIdFromDb } from "@/lib/local-storage"
import { getDocumentMatchesData } from "@/lib/document-matches-data"
import { getAllDocumentTypes, getDocumentTypesForInstitution } from "@/lib/document-types"
import { categoryLabel as staticCategoryLabel } from "@/lib/category-labels"
import { logInfo } from "@/lib/logger"
import { requireSessionApi } from "@/lib/require-session-api"

function resolveCategoryLabel(
  labelByCategory: Record<string, string>,
  category?: string | null,
): string {
  if (!category) return "—"
  return labelByCategory[category] ?? staticCategoryLabel(category)
}

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

  if (doc.status === "processing") {
    return NextResponse.json(
      { success: false, error: "Документ ещё обрабатывается", status: "processing" },
      { status: 409 },
    )
  }
  if (doc.status === "failed") {
    return NextResponse.json(
      { success: false, error: "Проверка документа завершилась с ошибкой", status: "failed" },
      { status: 409 },
    )
  }

  const payload = await getDocumentMatchesData(id)
  if (!payload) {
    return NextResponse.json({ success: false, error: "Документ не найден" }, { status: 404 })
  }

  const docTypes = doc.institutionId
    ? await getDocumentTypesForInstitution(doc.institutionId, false)
    : await getAllDocumentTypes()
  const labelByCategory = Object.fromEntries(docTypes.map((t) => [t.name, t.displayName]))

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
    similarDocuments: payload.similarDocuments.map((s) => ({
      id: s.id,
      title: s.title,
      author: s.author,
      userId: s.userId,
      similarity: s.similarity,
      category: s.category,
      categoryLabel: resolveCategoryLabel(labelByCategory, s.category),
    })),
    // UI list does not render fragments; keep payload small for the modal.
    fragments: [],
    borrowMatches: payload.borrowMatches.map((m) => ({
      sourceTitle: m.sourceTitle,
      sourceId: m.sourceId,
      sourceAuthor: m.sourceAuthor,
      similarity: m.similarity,
      matchType: m.matchType,
      matchTypeLabel: m.matchTypeLabel,
      category: m.category,
      categoryLabel: resolveCategoryLabel(labelByCategory, m.category),
      wordCount: m.wordCount,
      type: m.type,
    })),
    aiMatches: payload.aiMatches.map((m) => ({
      sourceTitle: m.sourceTitle,
      sourceId: m.sourceId,
      similarity: m.similarity,
      confidence: m.confidence,
      type: m.type,
    })),
    aiPercent: payload.aiPercent,
    localPlagiarismPercent: payload.localPlagiarismPercent,
    mlPlagiarismPercent: payload.mlPlagiarismPercent,
    plagiarismPercent: payload.plagiarismPercent,
    originalityPercent: payload.originalityPercent,
    byType: payload.byType,
  })
}
