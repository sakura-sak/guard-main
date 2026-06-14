import { type NextRequest, NextResponse } from "next/server"
import { getReportPdfBuffer, getDocumentByIdFromDb } from "@/lib/local-storage"
import { verifyDocumentAccess } from "@/lib/report-access"
import { getQrSignature } from "@/lib/report-verify-get"

/**
 * GET /api/report/:documentId/download?sig=...
 * Скачивание PDF отчёта (attachment). Требуется подпись sig.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> },
) {
  try {
    const { documentId } = await params
    const id = parseInt(documentId, 10)
    const sig = getQrSignature(request.nextUrl.searchParams)

    if (Number.isNaN(id)) {
      return NextResponse.json({ success: false, error: "Некорректный documentId" }, { status: 400 })
    }
    if (!sig || !verifyDocumentAccess("report", id, sig)) {
      return NextResponse.json(
        { success: false, error: "Доступ запрещён. Используйте ссылку из QR-кода на справке." },
        { status: 403 },
      )
    }

    const doc = await getDocumentByIdFromDb(id)
    if (!doc) {
      return NextResponse.json(
        { success: false, error: "Документ не найден в локальном хранилище" },
        { status: 404 },
      )
    }

    const buf = getReportPdfBuffer(id)
    if (!buf || buf.length === 0) {
      return NextResponse.json(
        { success: false, error: "Итоговый отчёт для этого документа не найден" },
        { status: 404 },
      )
    }

    const base = (doc.title || doc.filename || "report")
      .replace(/\.(pdf|docx|doc)$/i, "")
      .replace(/[^\w\u0400-\u04FF.-]/g, "_")
      .slice(0, 80) || "report"
    const filenameAscii = `spravka-${doc.id}.pdf`
    const filenameUtf8 = `spravka-${base}.pdf`

    return new NextResponse(buf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filenameAscii}"; filename*=UTF-8''${encodeURIComponent(filenameUtf8)}`,
        "Cache-Control": "private, max-age=3600",
      },
    })
  } catch (e) {
    console.error("Report download error:", e)
    return NextResponse.json({ success: false, error: "Ошибка при скачивании отчёта" }, { status: 500 })
  }
}
