import { type NextRequest, NextResponse } from "next/server"
import { getQrSignature, reportVerifyResponse } from "@/lib/report-verify-get"

/**
 * GET /api/report/verify?documentId=123&sig=...
 * Для QR-кода «подтверждение подлинности и актуальности справки».
 * Поддерживается битая разметка ?documentId=…&amp;sig=… (имя параметра amp;sig).
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
    return reportVerifyResponse(id, sig, raw)
  } catch (e) {
    console.error("Report verify error:", e)
    return NextResponse.json({ success: false, error: "Ошибка верификации" }, { status: 500 })
  }
}
