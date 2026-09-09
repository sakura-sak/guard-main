import { type NextRequest, NextResponse } from "next/server"
import {
  getDocumentByIdFromDb,
  isFileAccessAllowed,
} from "@/lib/local-storage"
import {
  contentDispositionAttachment,
  readDocumentFileFromDisk,
  resolveDocumentDownloadMeta,
} from "@/lib/document-download"
import { requireSessionApi } from "@/lib/require-session-api"

/**
 * GET /api/documents/:documentId/file
 * Download the original uploaded file (session: owner or admin).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> },
) {
  try {
    const gate = await requireSessionApi(request)
    if (!gate.ok) return gate.response

    const { documentId } = await params
    const id = parseInt(documentId, 10)
    if (Number.isNaN(id)) {
      return NextResponse.json({ success: false, error: "Некорректный ID" }, { status: 400 })
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

    if (!isFileAccessAllowed(doc)) {
      return NextResponse.json(
        { success: false, error: "Срок хранения файла истёк. Доступны только метрики отчёта." },
        { status: 403 },
      )
    }

    if (!doc.filePath) {
      return NextResponse.json(
        { success: false, error: "Оригинальный файл для этого документа не найден" },
        { status: 404 },
      )
    }

    const buf = readDocumentFileFromDisk(doc.filePath)
    if (!buf) {
      return NextResponse.json(
        { success: false, error: "Файл работы не найден на диске" },
        { status: 404 },
      )
    }

    const meta = resolveDocumentDownloadMeta(doc)
    return new NextResponse(buf, {
      headers: {
        "Content-Type": meta.mime,
        "Content-Disposition": contentDispositionAttachment(meta.downloadNameAscii, meta.downloadName),
        "Cache-Control": "private, max-age=3600",
      },
    })
  } catch (e) {
    console.error("Document file download error:", e)
    return NextResponse.json({ success: false, error: "Ошибка при получении файла" }, { status: 500 })
  }
}
