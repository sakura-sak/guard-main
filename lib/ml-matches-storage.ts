/**
 * Persist / load ML semantic_matches (cascade.py types) via plagiarism_matches.
 */

import { prisma } from "./prisma"

export type MlSemanticMatch = {
  documentId: number | null
  filename: string | null
  matchedChunks: number
  maxScore: number
  maxLexicalScore: number
  paraphraseScore: number
  matchType: "exact" | "paraphrase" | "semantic"
  sample: string
}

export type StoredMlMatchMeta = {
  matchType: "exact" | "paraphrase" | "semantic"
  sample: string
  maxScore: number
  maxLexicalScore: number
  paraphraseScore: number
  matchedChunks: number
  filename: string | null
}

function clampPercent(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(100, Math.round(n * 100) / 100))
}

function similarityFromMatch(m: MlSemanticMatch): number {
  const score = Math.max(m.maxScore || 0, m.maxLexicalScore || 0)
  return clampPercent(score * 100)
}

function parseMatchType(raw: unknown): "exact" | "paraphrase" | "semantic" {
  if (raw === "exact" || raw === "paraphrase" || raw === "semantic") return raw
  return "semantic"
}

/** Normalize ML API / FormData payload into typed matches. */
export function normalizeMlSemanticMatches(raw: unknown): MlSemanticMatch[] {
  if (!Array.isArray(raw)) return []
  const out: MlSemanticMatch[] = []
  for (const item of raw) {
    if (!item || typeof item !== "object") continue
    const row = item as Record<string, unknown>
    const docIdRaw = row.document_id ?? row.documentId
    const documentId =
      typeof docIdRaw === "number" && Number.isFinite(docIdRaw) && docIdRaw > 0
        ? Math.trunc(docIdRaw)
        : typeof docIdRaw === "string" && /^\d+$/.test(docIdRaw.trim())
          ? Number(docIdRaw.trim())
          : null
    out.push({
      documentId,
      filename: typeof row.filename === "string" ? row.filename : null,
      matchedChunks: Number(row.matched_chunks ?? row.matchedChunks ?? 0) || 0,
      maxScore: Number(row.max_score ?? row.maxScore ?? 0) || 0,
      maxLexicalScore: Number(row.max_lexical_score ?? row.maxLexicalScore ?? 0) || 0,
      paraphraseScore: Number(row.paraphrase_score ?? row.paraphraseScore ?? 0) || 0,
      matchType: parseMatchType(row.match_type ?? row.matchType),
      sample: typeof row.sample === "string" ? row.sample : "",
    })
  }
  return out
}

/**
 * Replace all ML matches for target document with the given list.
 * Only rows with a valid source document_id (existing FK) are stored.
 */
export async function replaceMlMatchesForDocument(
  targetDocumentId: number,
  matches: MlSemanticMatch[],
): Promise<number> {
  await prisma.plagiarismMatch.deleteMany({
    where: { targetDocumentId, algorithm: "ml" },
  })

  const withId = matches.filter((m) => typeof m.documentId === "number" && m.documentId > 0)
  if (!withId.length) return 0

  const sourceIds = [...new Set(withId.map((m) => m.documentId!))]
  const existing = await prisma.document.findMany({
    where: { id: { in: sourceIds } },
    select: { id: true },
  })
  const existingSet = new Set(existing.map((d) => d.id))

  let saved = 0
  for (const m of withId) {
    if (!m.documentId || !existingSet.has(m.documentId) || m.documentId === targetDocumentId) continue
    const meta: StoredMlMatchMeta = {
      matchType: m.matchType,
      sample: m.sample.slice(0, 2000),
      maxScore: m.maxScore,
      maxLexicalScore: m.maxLexicalScore,
      paraphraseScore: m.paraphraseScore,
      matchedChunks: m.matchedChunks,
      filename: m.filename,
    }
    try {
      await prisma.plagiarismMatch.upsert({
        where: {
          sourceDocumentId_targetDocumentId_algorithm: {
            sourceDocumentId: m.documentId,
            targetDocumentId,
            algorithm: "ml",
          },
        },
        create: {
          sourceDocumentId: m.documentId,
          targetDocumentId,
          similarityPercent: similarityFromMatch(m),
          matchedFragments: JSON.stringify(meta),
          algorithm: "ml",
        },
        update: {
          similarityPercent: similarityFromMatch(m),
          matchedFragments: JSON.stringify(meta),
        },
      })
      saved++
    } catch {
      /* skip orphan / race */
    }
  }
  return saved
}

export type LoadedMlBorrowMatch = {
  sourceTitle: string
  sourceId: number
  sourceAuthor: string
  similarity: number
  quote: string
  wordCount: number
  type: "borrow"
  matchType: "exact" | "paraphrase" | "semantic"
  category?: string
}

export async function loadMlBorrowMatches(targetDocumentId: number): Promise<LoadedMlBorrowMatch[]> {
  const rows = await prisma.plagiarismMatch.findMany({
    where: { targetDocumentId, algorithm: "ml" },
    include: {
      sourceDocument: {
        select: {
          id: true,
          title: true,
          category: true,
          userId: true,
          user: { select: { fullName: true } },
        },
      },
    },
    orderBy: { similarityPercent: "desc" },
  })

  return rows.map((row) => {
    let meta: Partial<StoredMlMatchMeta> = {}
    if (row.matchedFragments) {
      try {
        meta = JSON.parse(row.matchedFragments) as StoredMlMatchMeta
      } catch {
        meta = {}
      }
    }
    const title = row.sourceDocument.title || meta.filename || "—"
    const author =
      row.sourceDocument.user?.fullName?.trim() ||
      row.sourceDocument.userId ||
      ""
    const sample = typeof meta.sample === "string" ? meta.sample : ""
    return {
      sourceTitle: title,
      sourceId: row.sourceDocumentId,
      sourceAuthor: author,
      similarity: clampPercent(row.similarityPercent),
      quote: sample || `Совпадение с работой «${title}» (${meta.matchType || "semantic"}).`,
      wordCount: sample ? sample.split(/\s+/).filter(Boolean).length : 0,
      type: "borrow" as const,
      matchType: parseMatchType(meta.matchType),
      category: row.sourceDocument.category,
    }
  })
}

export const MATCH_TYPE_LABELS: Record<string, string> = {
  exact: "Дословное",
  paraphrase: "Перефраз",
  semantic: "Семантическое",
  local: "Локальное",
}
