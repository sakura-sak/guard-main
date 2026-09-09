import { beforeEach, describe, expect, it } from "vitest"
import { prismaMock, resetPrismaMock } from "../mocks/prisma-mock"
import {
  MATCH_TYPE_LABELS,
  loadMlBorrowMatches,
  normalizeMlSemanticMatches,
  replaceMlMatchesForDocument,
} from "@/lib/ml-matches-storage"

describe("ml-matches-storage", () => {
  beforeEach(() => {
    resetPrismaMock()
  })

  it("normalizes ML payload and labels", () => {
    expect(normalizeMlSemanticMatches(null)).toEqual([])
    const rows = normalizeMlSemanticMatches([
      {
        document_id: 17,
        filename: "src.docx",
        max_score: 0.9,
        max_lexical_score: 0.4,
        paraphrase_score: 0.2,
        match_type: "exact",
        sample: "фрагмент",
        matched_chunks: 3,
      },
      { documentId: "21", matchType: "unknown" },
    ])
    expect(rows[0].documentId).toBe(17)
    expect(rows[0].matchType).toBe("exact")
    expect(rows[1].matchType).toBe("semantic")
    expect(MATCH_TYPE_LABELS.paraphrase).toBe("Перефраз")
  })

  it("replaces and loads matches", async () => {
    prismaMock.document.findMany.mockResolvedValue([{ id: 17, userId: "other" }])
    prismaMock.plagiarismMatch.findMany.mockResolvedValue([
      {
        sourceDocumentId: 17,
        similarityPercent: 12,
        sourceDocument: {
          title: "Источник",
          category: "lab",
          user: { fullName: "Петров" },
          userId: "other",
        },
        matchedFragments: JSON.stringify({ matchType: "paraphrase", sample: "abc" }),
      },
    ])
    const stored = await replaceMlMatchesForDocument(42, [
      {
        documentId: 17,
        filename: "a.docx",
        matchedChunks: 1,
        maxScore: 0.8,
        maxLexicalScore: 0.2,
        paraphraseScore: 0.3,
        matchType: "paraphrase",
        sample: "abc",
      },
    ])
    expect(typeof stored).toBe("number")
    const loaded = await loadMlBorrowMatches(42)
    expect(Array.isArray(loaded)).toBe(true)
  })
})
