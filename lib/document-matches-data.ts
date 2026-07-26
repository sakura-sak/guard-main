import { getDocumentByIdFromDb, getDocumentsForComparison, type StoredDocument } from "@/lib/local-storage"
import {
  compareMinHashSignatures,
  findMatchingFragments,
  normalizeContentForCheck,
} from "@/lib/plagiarism/algorithms"

const NUM_HASHES = 128
const LOCAL_SIMILARITY_THRESHOLD = 10

function roundPercent(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.round(Math.max(0, Math.min(100, n)) * 100) / 100
}

export type DocumentMatchesPayload = {
  similarDocuments: Array<{
    id: number
    title: string
    author: string
    userId: string | null
    similarity: number
    category: string
  }>
  borrowMatches: Array<{
    sourceTitle: string
    sourceId: number
    sourceAuthor: string
    similarity: number
    quote: string
    wordCount: number
    type: "borrow"
  }>
  fragments: Array<{
    text: string
    sourceTitle: string
    sourceId: number
    similarity: number
    type: "borrow" | "ai"
  }>
  aiMatches: Array<{
    text: string
    sourceTitle: string
    sourceId: number
    similarity: number
    confidence: string
    quote: string
    type: "ai"
  }>
  aiPercent: number
  localPlagiarismPercent: number
  mlPlagiarismPercent: number
  plagiarismPercent: number
  originalityPercent: number
}

/** Shared matches computation for /matches and printable report API. */
export async function getDocumentMatchesData(documentId: number): Promise<DocumentMatchesPayload | null> {
  const doc = await getDocumentByIdFromDb(documentId)
  if (!doc) return null

  const hasValidSignature = Array.isArray(doc.minhashSignature) && doc.minhashSignature.length === NUM_HASHES
  const pool = hasValidSignature ? await getDocumentsForComparison(doc.category, doc.institutionId, documentId) : []
  const normalizedDocContent = normalizeContentForCheck(doc.content)
  const similarDocs = pool
    .filter((other) => Array.isArray(other.minhashSignature) && other.minhashSignature.length === NUM_HASHES)
    .map((other) => ({
      id: other.id,
      title: other.title,
      author: other.author ?? "",
      userId: other.userId ?? null,
      similarity: roundPercent(compareMinHashSignatures(doc.minhashSignature, other.minhashSignature) * 100),
      category: other.category,
      content: other.content,
    }))
    .filter((other) => other.similarity >= LOCAL_SIMILARITY_THRESHOLD)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 10)

  const borrowMatches: DocumentMatchesPayload["borrowMatches"] = []
  const fragments: DocumentMatchesPayload["fragments"] = []
  for (const sim of similarDocs.slice(0, 5)) {
    const matches = findMatchingFragments(normalizedDocContent, normalizeContentForCheck(sim.content), 5)
    const best = matches[0]
    if (!best) continue
    borrowMatches.push({
      sourceTitle: sim.title,
      sourceId: sim.id,
      sourceAuthor: sim.author ?? "",
      similarity: sim.similarity,
      quote: best.text,
      wordCount: best.wordCount,
      type: "borrow",
    })
    for (const m of matches.slice(0, 3)) {
      fragments.push({
        text: m.text,
        sourceTitle: sim.title,
        sourceId: sim.id,
        similarity: sim.similarity,
        type: "borrow",
      })
    }
  }

  if (borrowMatches.length === 0 && similarDocs.length > 0) {
    for (const sim of similarDocs.slice(0, 5)) {
      borrowMatches.push({
        sourceTitle: sim.title,
        sourceId: sim.id,
        sourceAuthor: sim.author ?? "",
        similarity: sim.similarity,
        quote: `Структурное сходство с работой «${sim.title}» (≈${Math.round(sim.similarity)}%). Точные непрерывные фрагменты не выделены.`,
        wordCount: 0,
        type: "borrow",
      })
    }
  }

  const localPlagiarismPercent = roundPercent(similarDocs[0]?.similarity ?? 0)
  const mlPlagiarismPercent = roundPercent(doc.plagiarismPercentMl ?? 0)
  const plagiarismPercent = Math.max(localPlagiarismPercent, mlPlagiarismPercent)

  const aiPercent = doc.aiPercentMl ?? 0
  const aiMatches: DocumentMatchesPayload["aiMatches"] = []
  if (aiPercent > 0 && doc.content.length > 200) {
    const chunk = doc.content.slice(0, 500)
    const aiRow = {
      text: chunk,
      sourceTitle: "AI-детектор",
      sourceId: 0,
      similarity: aiPercent,
      confidence: aiPercent >= 50 ? "высокая" : aiPercent >= 20 ? "средняя" : "низкая",
      quote: chunk,
      type: "ai" as const,
    }
    aiMatches.push(aiRow)
    fragments.push({
      text: chunk,
      sourceTitle: aiRow.sourceTitle,
      sourceId: aiRow.sourceId,
      similarity: aiPercent,
      type: "ai",
    })
  }

  return {
    similarDocuments: similarDocs.map(({ content: _c, ...sim }) => sim),
    borrowMatches,
    fragments,
    aiMatches,
    aiPercent,
    localPlagiarismPercent,
    mlPlagiarismPercent,
    plagiarismPercent,
    originalityPercent: doc.originalityPercent ?? roundPercent(100 - plagiarismPercent),
  }
}

export function resolveDocumentInstitution(doc: StoredDocument): string {
  return doc.institution?.trim() || "БГУИР"
}
