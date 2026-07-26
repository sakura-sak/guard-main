import { getDocumentByIdFromDb, getDocumentsForComparison, type StoredDocument } from "@/lib/local-storage"
import {
  compareMinHashSignatures,
  findMatchingFragments,
  normalizeContentForCheck,
} from "@/lib/plagiarism/algorithms"
import { loadMlBorrowMatches, MATCH_TYPE_LABELS } from "@/lib/ml-matches-storage"

const NUM_HASHES = 128
const LOCAL_SIMILARITY_THRESHOLD = 10

function roundPercent(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.round(Math.max(0, Math.min(100, n)) * 100) / 100
}

export type BorrowMatchRow = {
  sourceTitle: string
  sourceId: number
  sourceAuthor: string
  similarity: number
  quote: string
  wordCount: number
  type: "borrow"
  matchType: "exact" | "paraphrase" | "semantic" | "local"
  matchTypeLabel: string
  category?: string
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
  borrowMatches: BorrowMatchRow[]
  fragments: Array<{
    text: string
    sourceTitle: string
    sourceId: number
    similarity: number
    type: "borrow" | "ai"
    matchType?: BorrowMatchRow["matchType"]
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
  byType: { exact: number; paraphrase: number; semantic: number; local: number }
}

function emptyByType(): DocumentMatchesPayload["byType"] {
  return { exact: 0, paraphrase: 0, semantic: 0, local: 0 }
}

/** Shared matches computation for /matches and printable report API. */
export async function getDocumentMatchesData(documentId: number): Promise<DocumentMatchesPayload | null> {
  const doc = await getDocumentByIdFromDb(documentId)
  if (!doc) return null

  const hasValidSignature = Array.isArray(doc.minhashSignature) && doc.minhashSignature.length === NUM_HASHES
  const pool = hasValidSignature
    ? await getDocumentsForComparison(doc.category, doc.institutionId, documentId, doc.userId)
    : []
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

  const localBorrowMatches: BorrowMatchRow[] = []
  const fragments: DocumentMatchesPayload["fragments"] = []
  for (const sim of similarDocs.slice(0, 5)) {
    const matches = findMatchingFragments(normalizedDocContent, normalizeContentForCheck(sim.content), 5)
    const best = matches[0]
    if (!best) continue
    localBorrowMatches.push({
      sourceTitle: sim.title,
      sourceId: sim.id,
      sourceAuthor: sim.author ?? "",
      similarity: sim.similarity,
      quote: best.text,
      wordCount: best.wordCount,
      type: "borrow",
      matchType: "local",
      matchTypeLabel: MATCH_TYPE_LABELS.local,
      category: sim.category,
    })
    for (const m of matches.slice(0, 3)) {
      fragments.push({
        text: m.text,
        sourceTitle: sim.title,
        sourceId: sim.id,
        similarity: sim.similarity,
        type: "borrow",
        matchType: "local",
      })
    }
  }

  if (localBorrowMatches.length === 0 && similarDocs.length > 0) {
    for (const sim of similarDocs.slice(0, 5)) {
      localBorrowMatches.push({
        sourceTitle: sim.title,
        sourceId: sim.id,
        sourceAuthor: sim.author ?? "",
        similarity: sim.similarity,
        quote: `Структурное сходство с работой «${sim.title}» (≈${Math.round(sim.similarity)}%). Точные непрерывные фрагменты не выделены.`,
        wordCount: 0,
        type: "borrow",
        matchType: "local",
        matchTypeLabel: MATCH_TYPE_LABELS.local,
        category: sim.category,
      })
    }
  }

  const mlBorrowMatches = await loadMlBorrowMatches(documentId)
  const bySource = new Map<number, BorrowMatchRow>()

  for (const m of localBorrowMatches) {
    bySource.set(m.sourceId, m)
  }
  for (const m of mlBorrowMatches) {
    const row: BorrowMatchRow = {
      sourceTitle: m.sourceTitle,
      sourceId: m.sourceId,
      sourceAuthor: m.sourceAuthor,
      similarity: m.similarity,
      quote: m.quote,
      wordCount: m.wordCount,
      type: "borrow",
      matchType: m.matchType,
      matchTypeLabel: MATCH_TYPE_LABELS[m.matchType] || m.matchType,
      category: m.category,
    }
    const prev = bySource.get(m.sourceId)
    if (!prev || row.similarity >= prev.similarity) {
      bySource.set(m.sourceId, {
        ...row,
        // Prefer ML quote when present; keep local quote if ML sample empty.
        quote: row.quote?.trim() ? row.quote : prev?.quote || row.quote,
        wordCount: row.wordCount || prev?.wordCount || 0,
        similarity: Math.max(row.similarity, prev?.similarity ?? 0),
      })
    } else if (prev) {
      // Keep higher local similarity but attach cascade type from ML.
      bySource.set(m.sourceId, {
        ...prev,
        matchType: m.matchType,
        matchTypeLabel: MATCH_TYPE_LABELS[m.matchType] || m.matchType,
      })
    }
    if (m.quote?.trim()) {
      fragments.push({
        text: m.quote,
        sourceTitle: m.sourceTitle,
        sourceId: m.sourceId,
        similarity: m.similarity,
        type: "borrow",
        matchType: m.matchType,
      })
    }
  }

  const borrowMatches = [...bySource.values()].sort((a, b) => b.similarity - a.similarity)

  const byType = emptyByType()
  for (const m of borrowMatches) {
    byType[m.matchType] = (byType[m.matchType] || 0) + 1
  }

  // Ensure similarDocuments includes ML sources for category labels in UI/report.
  const similarById = new Map(similarDocs.map((s) => [s.id, s]))
  for (const m of borrowMatches) {
    if (!similarById.has(m.sourceId)) {
      similarById.set(m.sourceId, {
        id: m.sourceId,
        title: m.sourceTitle,
        author: m.sourceAuthor,
        userId: null,
        similarity: m.similarity,
        category: m.category || "",
        content: "",
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
    similarDocuments: [...similarById.values()]
      .map(({ content: _c, ...sim }) => sim)
      .sort((a, b) => b.similarity - a.similarity),
    borrowMatches,
    fragments,
    aiMatches,
    aiPercent,
    localPlagiarismPercent,
    mlPlagiarismPercent,
    plagiarismPercent,
    originalityPercent: doc.originalityPercent ?? roundPercent(100 - plagiarismPercent),
    byType,
  }
}

export function resolveDocumentInstitution(doc: StoredDocument): string {
  return doc.institution?.trim() || "БГУИР"
}
