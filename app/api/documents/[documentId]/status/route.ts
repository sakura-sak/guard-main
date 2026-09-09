import { type NextRequest, NextResponse } from "next/server"
import { getDocumentByIdFromDb, updateDocumentStatus, saveReportPdf, deleteReportPdf } from "@/lib/local-storage"
import { generatePDFReport } from "@/lib/pdf-report"
import { buildReportPayloadForDocument } from "@/lib/report-payload-for-document"
import { logInfo, logError } from "@/lib/logger"
import type { DocumentStatus } from "@/lib/local-storage"
import { requireSessionApi } from "@/lib/require-session-api"

import { resolvePublicBaseUrl } from "@/lib/report-qr-links"

/**
 * PATCH /api/documents/:documentId/status
 * Обновление статуса документа (draft -> final)
 * Доступно только владельцу документа
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> },
) {
  try {
    const gate = await requireSessionApi(request)
    if (!gate.ok) return gate.response

    const { documentId } = await params
    const id = parseInt(documentId, 10)

    if (Number.isNaN(id)) {
      return NextResponse.json({ success: false, error: "Некорректный ID документа" }, { status: 400 })
    }

    const body = await request.json()
    const { status } = body
    const userId = gate.user.username

    if (!status || (status !== "draft" && status !== "final")) {
      return NextResponse.json(
        { success: false, error: "Некорректный статус. Допустимые значения: draft, final" },
        { status: 400 },
      )
    }

    const doc = await getDocumentByIdFromDb(id)
    if (!doc) {
      return NextResponse.json({ success: false, error: "Документ не найден" }, { status: 404 })
    }

    // Проверяем, что пользователь является владельцем документа (если указан userId у документа)
    if (doc.userId && doc.userId !== userId && gate.user.role !== "admin" && gate.user.role !== "superadmin") {
      return NextResponse.json(
        { success: false, error: "Нельзя изменить статус чужого документа" },
        { status: 403 },
      )
    }

    if (doc.status === "processing") {
      return NextResponse.json(
        { success: false, error: "Документ ещё обрабатывается. Дождитесь завершения проверки." },
        { status: 409 },
      )
    }
    if (doc.status === "failed") {
      return NextResponse.json(
        { success: false, error: "Проверка документа завершилась с ошибкой. Загрузите документ заново." },
        { status: 409 },
      )
    }
    if (status === "final" && doc.status !== "draft") {
      return NextResponse.json(
        { success: false, error: "Финализировать можно только черновик с готовым результатом." },
        { status: 400 },
      )
    }

    const updated = await updateDocumentStatus(id, status as DocumentStatus)

    if (updated) {
      if (status === "final") {
        try {
          await deleteReportPdf(id)
          const payload = await buildReportPayloadForDocument(id, resolvePublicBaseUrl(request))
          if (!payload) {
            throw new Error(`Документ ${id} не найден при сборке PDF`)
          }
          const pdfBytes = await generatePDFReport(payload)
          await saveReportPdf(id, Buffer.from(pdfBytes), { generatedById: userId })
        } catch (e) {
          // Не блокируем смену статуса, если генерация отчета не удалась
          logError(
            "Не удалось сгенерировать отчет при финализации из профиля",
            e instanceof Error ? e.message : String(e),
            userId,
            undefined,
            "document_update",
          )
        }
      }

      logInfo(
        `Статус документа изменен на ${status}`,
        userId,
        undefined,
        "document_update",
        { documentId: id, status },
      )
      return NextResponse.json({
        success: true,
        message: `Статус документа изменен на ${status === "final" ? "финальный" : "черновой"}`,
        document: {
          id: doc.id,
          status: status,
        },
      })
    }

    return NextResponse.json(
      { success: false, error: "Не удалось обновить статус документа" },
      { status: 500 },
    )
  } catch (error) {
    console.error("Error updating document status:", error)
    logError(
      "Ошибка при обновлении статуса документа",
      error instanceof Error ? error.message : String(error),
      undefined,
      undefined,
      "document_update",
    )
    return NextResponse.json(
      { success: false, error: "Ошибка при обновлении статуса" },
      { status: 500 },
    )
  }
}
