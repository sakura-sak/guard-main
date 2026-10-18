/**
 * Build and store the PDF report for a finalized document.
 * A failure here must not roll back the status change.
 */

import type { NextRequest } from "next/server"
import { deleteReportPdf, saveReportPdf } from "./local-storage"
import { logError } from "./logger"
import { generatePDFReport } from "./pdf-report"
import { buildReportPayloadForDocument } from "./report-payload-for-document"
import { resolvePublicBaseUrl } from "./report-qr-links"

export async function generateAndSaveFinalReport(options: {
  documentId: number
  generatedById?: string | null
  request?: NextRequest
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await deleteReportPdf(options.documentId)
    const payload = await buildReportPayloadForDocument(
      options.documentId,
      resolvePublicBaseUrl(options.request),
    )
    if (!payload) {
      throw new Error(`Документ ${options.documentId} не найден при сборке PDF`)
    }
    const pdfBytes = await generatePDFReport(payload)
    await saveReportPdf(options.documentId, Buffer.from(pdfBytes), {
      generatedById: options.generatedById,
    })
    return { ok: true }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    logError(
      "Не удалось сгенерировать отчет при финализации",
      error,
      options.generatedById ?? undefined,
      undefined,
      "document_update",
    )
    return { ok: false, error }
  }
}
