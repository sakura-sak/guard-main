import { type NextRequest, NextResponse } from "next/server"
import { getDocumentByIdFromDb } from "@/lib/local-storage"
import { buildReportQrLinks, resolvePublicBaseUrl } from "@/lib/report-qr-links"
import { qrPngDataUrl } from "@/lib/report-qr-images"
import { requireSessionOrMoodleApi } from "@/lib/require-moodle-api"

function resolveBaseUrlForLinks(request: NextRequest): string {
  const fromHelper = resolvePublicBaseUrl(request)
  if (fromHelper) return fromHelper
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim()
    ?? request.headers.get("host")?.trim()
  if (!host) return ""
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https" ? "https" : "http"
  return `${proto}://${host}`.replace(/\/$/, "")
}

/**
 * GET /api/report/:documentId/links
 * Подписанные URL для QR-кодов в браузерной справке (печать из app/admin).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> },
) {
  try {
    const gate = await requireSessionOrMoodleApi(request)
    if (!gate.ok) return gate.response

    const { documentId } = await params
    const id = parseInt(documentId, 10)
    if (Number.isNaN(id)) {
      return NextResponse.json({ success: false, error: "Некорректный ID документа" }, { status: 400 })
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

    const baseUrl = resolveBaseUrlForLinks(request)
    if (!baseUrl) {
      return NextResponse.json(
        { success: false, error: "Не задан публичный URL (Host / NEXT_PUBLIC_APP_URL / REPORT_PUBLIC_BASE_URL)" },
        { status: 500 },
      )
    }

    const links = buildReportQrLinks(id, baseUrl)
    const [verifyQrImage, originalQrImage] = await Promise.all([
      qrPngDataUrl(links.verifyUrl),
      qrPngDataUrl(links.originalUrl),
    ])
    return NextResponse.json({
      success: true,
      ...links,
      verifyQrImage,
      originalQrImage,
    })
  } catch (error) {
    console.error("Report links error:", error)
    return NextResponse.json({ success: false, error: "Не удалось сформировать ссылки" }, { status: 500 })
  }
}
