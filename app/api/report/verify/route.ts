import { type NextRequest, NextResponse } from "next/server"
import { getQrSignature } from "@/lib/report-verify-get"
import { verifyDocumentAccess } from "@/lib/report-access"

/**
 * GET /api/report/verify?documentId=123&sig=...
 * Legacy QR links redirect to unified HTML report; JSON still supported with ?raw=1.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const documentId = searchParams.get("documentId")
    const sig = getQrSignature(searchParams)
    const raw = searchParams.get("raw") === "1"

    if (!documentId) {
      return NextResponse.json({ success: false, error: "documentId обязателен" }, { status: 400 })
    }

    const id = parseInt(documentId, 10)
    if (Number.isNaN(id) || !sig || !verifyDocumentAccess("report", id, sig)) {
      return NextResponse.json(
        { success: false, error: "Доступ запрещён. Используйте ссылку из QR-кода на справке." },
        { status: 403 },
      )
    }

    if (raw) {
      const { reportVerifyResponse } = await import("@/lib/report-verify-get")
      return reportVerifyResponse(id, sig, true)
    }

    const url = new URL(`/report.html?documentId=${id}&sig=${encodeURIComponent(sig)}`, request.url)
    return NextResponse.redirect(url)
  } catch (e) {
    console.error("Report verify error:", e)
    return NextResponse.json({ success: false, error: "Ошибка верификации" }, { status: 500 })
  }
}
