/**
 * Восстановление списка похожих работ для PDF по сохранённому документу (тот же алгоритм, что и /api/check).
 */

import { createShingles, MinHash, compareMinHashSignatures, normalizeContentForCheck } from "@/lib/plagiarism/algorithms"
import { getAllDocumentsFromDb, getDocumentByIdFromDb } from "@/lib/local-storage"
import type { SimilarDocumentForReport } from "@/lib/pdf-report"

const NUM_HASHES = 128
const LOCAL_SIMILARITY_THRESHOLD = 10

function roundPercent(n: number): number {
  return Math.round(Math.max(0, Math.min(100, n)) * 100) / 100
}

function normalizeCategory(category: string): string {
  return category.replace(/[^a-zA-Z0-9а-яА-ЯёЁ_-]/g, "_").trim() || "uncategorized"
}

/**
 * Находит похожие документы в той же категории (исключая текущий), minhash как при проверке.
 */
export async function getSimilarDocumentsForReport(
  documentId: number,
  topK = 10,
): Promise<SimilarDocumentForReport[]> {
  const doc = await getDocumentByIdFromDb(documentId)
  if (!doc) return []

  const normCat = normalizeCategory(doc.category)
  const pool = await getAllDocumentsFromDb(doc.userId ?? undefined, undefined, [normCat])

  const normalizedContent = normalizeContentForCheck(doc.content)
  const queryShingles = createShingles(normalizedContent, 5)
  const querySignature = new MinHash(NUM_HASHES).computeSignature(queryShingles)

  const matches: SimilarDocumentForReport[] = []

  for (const other of pool) {
    if (other.id === documentId) continue
    if (!Array.isArray(other.minhashSignature) || other.minhashSignature.length !== NUM_HASHES) continue
    const similarity = roundPercent(compareMinHashSignatures(querySignature, other.minhashSignature) * 100)
    if (similarity < LOCAL_SIMILARITY_THRESHOLD) continue
    matches.push({
      id: other.id,
      title: other.title,
      author: other.author,
      userId: other.userId ?? null,
      similarity,
      category: other.category,
    })
  }

  return matches.sort((a, b) => b.similarity - a.similarity).slice(0, topK)
}
