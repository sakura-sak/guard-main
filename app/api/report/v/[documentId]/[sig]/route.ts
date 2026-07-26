import { type NextRequest, NextResponse } from "next/server"
import { decodePathSegmentSig } from "@/lib/report-verify-get"
import { verifyDocumentAccess } from "@/lib/report-access"

/**
 * GET /api/report/v/:documentId/:sig
 * Legacy QR links redirect to unified HTML report; JSON still supported with ?raw=1.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ documentId: string; sig: string }> },
) {
  try {
    const { documentId: documentIdRaw, sig: sigRaw } = await params
    const id = parseInt(documentIdRaw, 10)
    const rawJson = request.nextUrl.searchParams.get("raw") === "1"
    const sig = decodePathSegmentSig(sigRaw)

    if (Number.isNaN(id) || !sig || !verifyDocumentAccess("report", id, sig)) {
      return NextResponse.json(
        { success: false, error: "Доступ запрещён. Используйте ссылку из QR-кода на справке." },
        { status: 403 },
      )
    }

    if (rawJson) {
      const { reportVerifyResponse } = await import("@/lib/report-verify-get")
      return reportVerifyResponse(id, sig, true)
    }

    const url = new URL(`/report.html?documentId=${id}&sig=${encodeURIComponent(sig)}`, request.url)
    return NextResponse.redirect(url)
  } catch (e) {
    console.error("Report verify (v) error:", e)
    return NextResponse.json({ success: false, error: "Ошибка верификации" }, { status: 500 })
  }
}
