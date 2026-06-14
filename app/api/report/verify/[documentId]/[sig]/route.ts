import { type NextRequest, NextResponse } from "next/server"
import { decodePathSegmentSig, reportVerifyResponse } from "@/lib/report-verify-get"

/** @deprecated Совместимость со старыми QR; новые справки — GET /api/report/v/:documentId/:sig */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ documentId: string; sig: string }> },
) {
  try {
    const { documentId: documentIdRaw, sig: sigRaw } = await params
    const id = parseInt(documentIdRaw, 10)
    const rawJson = request.nextUrl.searchParams.get("raw") === "1"
    const sig = decodePathSegmentSig(sigRaw)

    return reportVerifyResponse(id, sig, rawJson)
  } catch (e) {
    console.error("Report verify (legacy path) error:", e)
    return NextResponse.json({ success: false, error: "Ошибка верификации" }, { status: 500 })
  }
}
