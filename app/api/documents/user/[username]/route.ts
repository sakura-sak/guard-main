import { type NextRequest, NextResponse } from "next/server"
import { getUserDocuments, getReportPdfPath, computeDraftExpiresAt } from "@/lib/local-storage"
import { signDocumentAccess } from "@/lib/report-access"
import { categoryLabel } from "@/lib/category-labels"
import { requireSessionApi } from "@/lib/require-session-api"

function getBaseUrl(request: NextRequest): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host")
  const proto = request.headers.get("x-forwarded-proto") ?? "http"
  if (!host) return ""
  const hostLower = host.toLowerCase()
  if (hostLower.includes("localhost") || hostLower.includes("127.0.0.1")) return ""
  return `${proto === "https" ? "https" : "http"}://${host}`
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ username: string }> },
) {
  const gate = await requireSessionApi(request)
  if (!gate.ok) return gate.response

  try {
    const { username } = await params

    if (!username) {
      return NextResponse.json({ success: false, error: "Username is required" }, { status: 400 })
    }

    const isAdmin = gate.user.role === "admin" || gate.user.role === "superadmin"
    if (username !== gate.user.username && !isAdmin) {
      return NextResponse.json({ success: false, error: "Нет доступа" }, { status: 403 })
    }

    const documents = await getUserDocuments(username)
    const baseUrl = getBaseUrl(request)

    const documentsSummary = documents.map((doc) => {
      const hasReport = (doc.status === "final" || doc.status === "archived") && !!getReportPdfPath(doc.id)
      const sig = hasReport ? signDocumentAccess("report", doc.id) : null
      const reportViewPath = `/api/report/${doc.id}/view?sig=${encodeURIComponent(sig ?? "")}`
      const reportDownloadPath = `/api/report/${doc.id}/download?sig=${encodeURIComponent(sig ?? "")}`
      const reportViewUrl = sig ? (baseUrl ? `${baseUrl}${reportViewPath}` : reportViewPath) : null
      const reportDownloadUrl = sig ? (baseUrl ? `${baseUrl}${reportDownloadPath}` : reportDownloadPath) : null
      const expiresAt = doc.expiresAt ?? (doc.status === "draft" ? computeDraftExpiresAt(doc.uploadDate) : null)

      return {
        id: doc.id,
        title: doc.title,
        author: doc.author,
        filename: doc.filename,
        category: doc.category,
        categoryLabel: categoryLabel(doc.category),
        uploadDate: doc.uploadDate,
        status: doc.status,
        originalityPercent: doc.originalityPercent,
        plagiarismPercentMl: doc.plagiarismPercentMl,
        aiPercentMl: doc.aiPercentMl,
        expiresAt,
        reportViewUrl,
        reportDownloadUrl,
      }
    })

    return NextResponse.json({
      success: true,
      count: documentsSummary.length,
      documents: documentsSummary,
    })
  } catch (error) {
    console.error("Error fetching user documents:", error)
    return NextResponse.json({ success: false, error: "Failed to fetch documents" }, { status: 500 })
  }
}
