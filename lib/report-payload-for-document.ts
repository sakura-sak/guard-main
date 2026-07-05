/**
 * Единый источник данных для PDF/QR-отчёта: свежая запись из БД + те же метрики, что /matches.
 */

import {
  getDocumentByIdFromDb,
  getDocumentAuthorLabel,
  type StoredDocument,
} from "@/lib/local-storage"
import { getSimilarDocumentsForReport } from "@/lib/similar-documents-for-report"
import type { CheckResultForReport } from "@/lib/pdf-report"

function roundPercent(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.round(Math.max(0, Math.min(100, n)) * 100) / 100
}

/** Метрики как в GET /api/documents/:id/matches и /api/check. */
export function resolveDocumentCheckScores(
  doc: StoredDocument,
  similarDocuments: { similarity: number }[],
): {
  originalityPercent: number
  plagiarismPercentMl: number
  aiPercentMl: number
  localPlagiarismPercent: number
} {
  const localPlagiarismPercent = roundPercent(similarDocuments[0]?.similarity ?? 0)
  const plagiarismPercentMl = roundPercent(doc.plagiarismPercentMl ?? 0)
  const aiPercentMl = roundPercent(doc.aiPercentMl ?? 0)
  const plagiarismPercent = Math.max(localPlagiarismPercent, plagiarismPercentMl)
  const originalityPercent =
    typeof doc.originalityPercent === "number" && Number.isFinite(doc.originalityPercent)
      ? roundPercent(doc.originalityPercent)
      : roundPercent(100 - plagiarismPercent)
  return { originalityPercent, plagiarismPercentMl, aiPercentMl, localPlagiarismPercent }
}

/** Собирает payload для generatePDFReport из актуальных данных документа в БД. */
export async function buildReportPayloadForDocument(
  documentId: number,
  baseUrl: string,
): Promise<CheckResultForReport | null> {
  const doc = await getDocumentByIdFromDb(documentId)
  if (!doc) return null

  let similarDocuments = await getSimilarDocumentsForReport(documentId).catch(() => [])
  const scores = resolveDocumentCheckScores(doc, similarDocuments)

  return {
    filename: doc.filename || `${doc.title || "document"}.txt`,
    title: doc.title,
    author: getDocumentAuthorLabel(doc),
    category: doc.category,
    uniquenessPercent: scores.originalityPercent,
    totalDocumentsChecked: similarDocuments.length,
    similarDocuments,
    processingTimeMs: doc.processingTimeMs ?? 0,
    plagiarismPercentMl: scores.plagiarismPercentMl,
    aiPercentMl: scores.aiPercentMl,
    uploadDate: doc.uploadDate,
    status: "final",
    documentId,
    baseUrl,
  }
}
