import { type NextRequest, NextResponse } from "next/server"
import { getUserDocuments } from "@/lib/local-storage"
import { categoryLabel } from "@/lib/category-labels"
import { getAllDocumentTypes } from "@/lib/document-types"
import { requireSessionApi } from "@/lib/require-session-api"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ username: string }> },
) {
  const gate = await requireSessionApi(request)
  if (!gate.ok) return gate.response

  const { username } = await params
  const isAdmin = gate.user.role === "admin" || gate.user.role === "superadmin"
  if (gate.user.username !== username && !isAdmin) {
    return NextResponse.json({ success: false, error: "Нет доступа" }, { status: 403 })
  }

  const documents = await getUserDocuments(username)
  const docTypes = await getAllDocumentTypes(true)
  const labelByCategory = Object.fromEntries(docTypes.map((t) => [t.name, t.displayName]))

  return NextResponse.json({
    success: true,
    documents: documents.map((doc) => ({
      id: doc.id,
      title: doc.title,
      author: doc.author,
      filename: doc.filename,
      wordCount: doc.wordCount,
      uploadDate: doc.uploadDate,
      category: doc.category,
      categoryLabel: labelByCategory[doc.category] ?? categoryLabel(doc.category),
      status: doc.status,
      originalityPercent: doc.originalityPercent,
      plagiarismPercentMl: doc.plagiarismPercentMl,
      aiPercentMl: doc.aiPercentMl,
      expiresAt: doc.expiresAt,
    })),
  })
}
