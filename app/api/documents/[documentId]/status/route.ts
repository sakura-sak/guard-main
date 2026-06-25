import { type NextRequest, NextResponse } from "next/server"
import { getDocumentByIdFromDb, updateDocumentStatus, getReportPdfPath, saveReportPdf, getDocumentAuthorLabel } from "@/lib/local-storage"
import { generatePDFReport } from "@/lib/pdf-report"
import { getSimilarDocumentsForReport } from "@/lib/similar-documents-for-report"
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

    const updated = await updateDocumentStatus(id, status as DocumentStatus)

    if (updated) {
      // Если переводим документ в финальный статус из профиля и PDF-отчета еще нет —
      // генерируем его на основе сохраненных данных документа.
      if (status === "final" && !getReportPdfPath(id)) {
        try {
          const uniquenessPercent =
            doc.originalityPercent !== null && doc.originalityPercent !== undefined
              ? doc.originalityPercent
              : 100
          let similarDocuments: Awaited<ReturnType<typeof getSimilarDocumentsForReport>> = []
          try {
            similarDocuments = await getSimilarDocumentsForReport(id)
          } catch {
            similarDocuments = []
          }
          const pdfBytes = await generatePDFReport({
            filename: doc.filename || `${doc.title || "document"}.txt`,
            title: doc.title,
            author: getDocumentAuthorLabel(doc),
            category: doc.category,
            uniquenessPercent,
            totalDocumentsChecked: similarDocuments.length > 0 ? similarDocuments.length : 0,
            similarDocuments,
            processingTimeMs: doc.processingTimeMs ?? 0,
            plagiarismPercentMl: doc.plagiarismPercentMl,
            aiPercentMl: doc.aiPercentMl,
            uploadDate: doc.uploadDate,
            status: "final",
            documentId: id,
            baseUrl: resolvePublicBaseUrl(request),
          })
          saveReportPdf(id, Buffer.from(pdfBytes), uniquenessPercent)
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
