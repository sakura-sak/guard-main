import { type NextRequest, NextResponse } from "next/server"
import { getDocumentByIdFromDb } from "@/lib/local-storage"
import { verifyDocumentAccess } from "@/lib/report-access"
import { getQrSignature } from "@/lib/report-verify-get"
import { requireSessionApi } from "@/lib/require-session-api"
import { buildReportPrintPayload, resolveBaseUrlForReport } from "@/lib/report-print-payload"

/**
 * GET /api/report/:documentId/print-data?sig=
 * JSON for unified HTML report (download + QR). Auth: session owner/admin OR valid report sig.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> },
) {
  try {
    const { documentId } = await params
    const id = parseInt(documentId, 10)
    if (Number.isNaN(id)) {
      return NextResponse.json({ success: false, error: "Некорректный ID документа" }, { status: 400 })
    }

    const doc = await getDocumentByIdFromDb(id)
    if (!doc) {
      return NextResponse.json({ success: false, error: "Документ не найден" }, { status: 404 })
    }

    const sig = getQrSignature(request.nextUrl.searchParams)
    let allowed = !!(sig && verifyDocumentAccess("report", id, sig))

    if (!allowed) {
      const gate = await requireSessionApi(request)
      if (!gate.ok) return gate.response
      const isOwner = doc.userId === gate.user.username
      const isAdmin = gate.user.role === "admin" || gate.user.role === "superadmin"
      allowed = isOwner || isAdmin
    }

    if (!allowed) {
      return NextResponse.json({ success: false, error: "Нет доступа" }, { status: 403 })
    }

    const baseUrl = resolveBaseUrlForReport(request)
    if (!baseUrl) {
      return NextResponse.json(
        { success: false, error: "Не задан публичный URL (Host / NEXT_PUBLIC_APP_URL / REPORT_PUBLIC_BASE_URL)" },
        { status: 500 },
      )
    }

    const payload = await buildReportPrintPayload(id, baseUrl)
    if (!payload) {
      return NextResponse.json({ success: false, error: "Не удалось собрать отчёт" }, { status: 500 })
    }

    return NextResponse.json({ success: true, ...payload })
  } catch (error) {
    console.error("Report print-data error:", error)
    return NextResponse.json({ success: false, error: "Ошибка формирования отчёта" }, { status: 500 })
  }
}
