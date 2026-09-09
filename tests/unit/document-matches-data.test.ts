import { beforeEach, describe, expect, it } from "vitest"
import { getDocumentMatchesData, resolveDocumentInstitution } from "@/lib/document-matches-data"
import { prismaMock, resetPrismaMock, sampleDocumentRow } from "../mocks/prisma-mock"

const longText = "методы поиска похожих документов в корпусе университета ".repeat(8)

function docRow(overrides: Record<string, unknown> = {}) {
  return {
    ...sampleDocumentRow,
    status: "final",
    expiresAt: new Date("2027-12-01"),
    contentPayload: { text: longText },
    signaturePayload: { minhash: Array.from({ length: 128 }, (_, i) => i), shingleCount: 80 },
    ...overrides,
  }
}

describe("document-matches-data", () => {
  beforeEach(() => {
    resetPrismaMock()
    prismaMock.document.findUnique.mockResolvedValue(docRow())
    prismaMock.document.findMany.mockResolvedValue([
      docRow({
        id: 77,
        title: "Чужая работа",
        userId: "other",
        user: { fullName: "Петров", institution: { name: "БГУИР" }, faculty: { name: "ФКСиС" } },
      }),
    ])
    prismaMock.plagiarismMatch.findMany.mockResolvedValue([
      {
        sourceDocumentId: 77,
        similarityPercent: 22,
        sourceDocument: {
          title: "Чужая работа",
          category: "lab",
          user: { fullName: "Петров" },
          userId: "other",
        },
        matchedFragments: JSON.stringify({ matchType: "paraphrase", sample: "методы поиска похожих документов" }),
      },
    ])
  })

  it("returns null when document is missing", async () => {
    prismaMock.document.findUnique.mockResolvedValueOnce(null)
    expect(await getDocumentMatchesData(1)).toBeNull()
  })

  it("merges local and ML matches and adds AI fragment", async () => {
    const data = await getDocumentMatchesData(42)
    expect(data).not.toBeNull()
    expect(data!.plagiarismPercent).toBeGreaterThan(0)
    expect(data!.borrowMatches.length).toBeGreaterThan(0)
    expect(data!.aiMatches.length).toBeGreaterThan(0)
    expect(data!.byType.paraphrase + data!.byType.local + data!.byType.exact).toBeGreaterThan(0)
    expect(resolveDocumentInstitution({ institution: "  " } as never)).toBe("БГУИР")
    expect(resolveDocumentInstitution({ institution: "БГУ" } as never)).toBe("БГУ")
  })
})
