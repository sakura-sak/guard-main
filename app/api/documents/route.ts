import { type NextRequest, NextResponse } from "next/server"
import { getAllDocumentsFromDb, deleteDocumentFromDb, getDocumentCountFromDb, computeDraftExpiresAt } from "@/lib/local-storage"
import { writeAuditLog } from "@/lib/audit-log"
import { requireAdminApi } from "@/lib/require-admin-api"
import { requireSessionApi } from "@/lib/require-session-api"
import { getAllDocumentTypes } from "@/lib/document-types"
import { categoryLabel as staticCategoryLabel } from "@/lib/category-labels"

// GET - Список всех документов (admin / teacher)
export async function GET(request: NextRequest) {
  const gate = await requireSessionApi(request, ["admin", "superadmin", "teacher"])
  if (!gate.ok) return gate.response
  try {
    const { searchParams } = new URL(request.url)
    const statusFilter = searchParams.get("status")
    let documents = await getAllDocumentsFromDb()

    if (statusFilter) {
      documents = documents.filter((d) => d.status === statusFilter)
    }

    const count = await getDocumentCountFromDb()
    const docTypes = await getAllDocumentTypes(true)
    const labelByCategory = Object.fromEntries(docTypes.map((t) => [t.name, t.displayName]))

    const documentsSummary = documents.map((doc) => ({
      id: doc.id,
      title: doc.title,
      author: doc.author,
      filename: doc.filename,
      filePath: doc.filePath,
      wordCount: doc.wordCount,
      uploadDate: doc.uploadDate,
      category: doc.category,
      categoryLabel: labelByCategory[doc.category] ?? staticCategoryLabel(doc.category),
      status: doc.status,
      userId: doc.userId,
      institution: doc.institution,
      originalityPercent: doc.originalityPercent,
      plagiarismPercentMl: doc.plagiarismPercentMl,
      aiPercentMl: doc.aiPercentMl,
      documentType: doc.documentType,
      processingTimeMs: doc.processingTimeMs,
      expiresAt: doc.expiresAt ?? (doc.status === "draft" ? computeDraftExpiresAt(doc.uploadDate) : null),
    }))

    return NextResponse.json({
      success: true,
      count,
      documents: documentsSummary,
    })
  } catch (error) {
    console.error("Error fetching documents:", error)
    return NextResponse.json({ success: false, error: "Failed to fetch documents" }, { status: 500 })
  }
}

// DELETE - Удаление документа (и файла с диска)
export async function DELETE(request: NextRequest) {
  const gate = await requireAdminApi(request)
  if (!gate.ok) return gate.response
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get("id")

    if (!id) {
      return NextResponse.json({ success: false, error: "Document ID is required" }, { status: 400 })
    }

    const deleted = await deleteDocumentFromDb(Number.parseInt(id))

    if (deleted) {
      await writeAuditLog({
        userId: gate.username,
        action: "admin_delete_document",
        level: "info",
        message: `Документ #${id} удалён`,
        entityType: "document",
        entityId: id,
      })
      return NextResponse.json({
        success: true,
        message: "Документ и файл удалены",
      })
    } else {
      return NextResponse.json({ success: false, error: "Document not found" }, { status: 404 })
    }
  } catch (error) {
    console.error("Error deleting document:", error)
    return NextResponse.json({ success: false, error: "Failed to delete document" }, { status: 500 })
  }
}
