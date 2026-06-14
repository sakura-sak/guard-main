import { type NextRequest, NextResponse } from "next/server"
import { getDocumentByIdFromDb, isFileAccessAllowed } from "@/lib/local-storage"
import { verifyDocumentAccess } from "@/lib/report-access"
import { getQrSignature } from "@/lib/report-verify-get"
import fs from "fs"
import path from "path"

const MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".doc": "application/msword",
}

/**
 * GET /api/report/:documentId/original?sig=...
 * Отдаёт оригинальную загруженную работу. Требуется подпись sig из QR-кода.
 * Без валидной подписи доступ запрещён (защита от подмены ID и доступа к чужим документам).
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
    if (!sig || !verifyDocumentAccess("original", id, sig)) {
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

    const fullPath = path.join(process.cwd(), doc.filePath)
    if (!fs.existsSync(fullPath)) {
      return NextResponse.json(
        { success: false, error: "Файл работы не найден на диске" },
        { status: 404 },
      )
    }

    const buf = fs.readFileSync(fullPath)
    const ext = path.extname(doc.filePath).toLowerCase()
    const mime = MIME[ext] ?? "application/octet-stream"
    const filenameAscii = `work-${id}${ext}`

    return new NextResponse(buf, {
      headers: {
        "Content-Type": mime,
        "Content-Disposition": `inline; filename="${filenameAscii}"`,
        "Cache-Control": "private, max-age=3600",
      },
    })
  } catch (e) {
    console.error("Original file serve error:", e)
    return NextResponse.json({ success: false, error: "Ошибка при получении файла" }, { status: 500 })
  }
}
