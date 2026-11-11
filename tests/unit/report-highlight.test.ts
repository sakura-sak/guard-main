import { describe, expect, it } from "vitest"
import { locateHighlightSpans } from "@/lib/report-highlight"

const text = "Введение. Методы поиска похожих документов описаны ниже. Конец работы."

describe("locateHighlightSpans", () => {
  it("finds a fragment and numbers the source", () => {
    const spans = locateHighlightSpans(text, [
      {
        queryText: "Методы поиска похожих документов",
        sourceId: 7,
        matchType: "exact",
      },
    ])
    expect(spans).toHaveLength(1)
    expect(text.slice(spans[0].start, spans[0].end)).toBe("Методы поиска похожих документов")
    expect(spans[0].sourceIndex).toBe(1)
    expect(spans[0].sourceId).toBe(7)
  })

  it("drops an overlapping later span", () => {
    const spans = locateHighlightSpans(text, [
      { queryText: "Методы поиска похожих документов описаны", sourceId: 1, matchType: "exact" },
      { queryText: "похожих документов описаны ниже", sourceId: 2, matchType: "paraphrase" },
    ])
    expect(spans.map((span) => span.sourceId)).toEqual([1])
  })

  it("ignores a needle that is not in the work", () => {
    expect(locateHighlightSpans(text, [
      { queryText: "рецепт борща со сметаной", sourceId: 3, matchType: "semantic" },
    ])).toEqual([])
  })
})
