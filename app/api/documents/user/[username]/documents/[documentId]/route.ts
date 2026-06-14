import { type NextRequest, NextResponse } from "next/server"
import {
  getDocumentByIdFromDb,
  deleteDocumentFromDb,
  deleteReportPdf,
} from "@/lib/local-storage"

/**
 * DELETE /api/documents/user/:username/documents/:documentId
 * Удаление своей работы. Доступно только владельцу (userId === username).
 * Удаляет документ из БД, файл работы и PDF-отчёт.
 */
import { requireSessionApi } from "@/lib/require-session-api"

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ username: string; documentId: string }> },
) {
  try {
    const gate = await requireSessionApi(request)
    if (!gate.ok) return gate.response

    const { username, documentId } = await params
    const id = parseInt(documentId, 10)

    if (!username) {
      return NextResponse.json({ success: false, error: "Укажите пользователя" }, { status: 400 })
    }
    if (Number.isNaN(id)) {
      return NextResponse.json({ success: false, error: "Некорректный ID документа" }, { status: 400 })
    }

    const doc = await getDocumentByIdFromDb(id)
    if (!doc) {
      return NextResponse.json(
        { success: false, error: "Документ не найден" },
        { status: 404 },
      )
    }

    if (doc.userId !== username && gate.user.role !== "admin" && gate.user.role !== "superadmin") {
      return NextResponse.json(
        { success: false, error: "Нельзя удалить чужой документ" },
        { status: 403 },
      )
    }

    deleteReportPdf(id)
    const deleted = await deleteDocumentFromDb(id)

    if (deleted) {
      return NextResponse.json({
        success: true,
        message: "Документ и отчёт удалены",
      })
    }

    return NextResponse.json(
      { success: false, error: "Не удалось удалить документ" },
      { status: 500 },
    )
  } catch (error) {
    console.error("Error deleting user document:", error)
    return NextResponse.json(
      { success: false, error: "Ошибка при удалении" },
      { status: 500 },
    )
  }
}
