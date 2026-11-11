/**
 * Positions of borrowed fragments inside the checked work.
 * Used only by the full report. The brief report does not call this.
 */

export type HighlightMatchType = "exact" | "paraphrase" | "semantic" | "local"

export type HighlightQuery = {
  queryText: string
  sourceId: number
  matchType: HighlightMatchType
}

export type HighlightSpan = {
  start: number
  end: number
  sourceId: number
  sourceIndex: number
  matchType: HighlightMatchType
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function findLoose(haystack: string, needle: string): { start: number; end: number } | null {
  const trimmed = needle.trim()
  if (trimmed.length < 12) return null
  const direct = haystack.indexOf(trimmed)
  if (direct >= 0) return { start: direct, end: direct + trimmed.length }
  const lowerHay = haystack.toLowerCase()
  const lowerNeedle = trimmed.toLowerCase()
  const folded = lowerHay.indexOf(lowerNeedle)
  if (folded >= 0) return { start: folded, end: folded + lowerNeedle.length }

  const words = lowerNeedle.split(/\s+/).filter((word) => word.length > 2).slice(0, 14)
  if (words.length < 4) return null
  const pattern = words.map(escapeRegExp).join("[\\s\\p{P}]+")
  const match = new RegExp(pattern, "iu").exec(haystack)
  if (!match || match.index == null) return null
  return { start: match.index, end: match.index + match[0].length }
}

/**
 * Non-overlapping spans, earlier and longer matches win.
 * sourceIndex is 1-based and follows the order of sourceIds.
 */
export function locateHighlightSpans(text: string, queries: HighlightQuery[]): HighlightSpan[] {
  if (!text || !queries.length) return []
  const order: number[] = []
  const indexById = new Map<number, number>()
  for (const query of queries) {
    if (!indexById.has(query.sourceId)) {
      order.push(query.sourceId)
      indexById.set(query.sourceId, order.length)
    }
  }

  const found: HighlightSpan[] = []
  for (const query of queries) {
    const span = findLoose(text, query.queryText)
    if (!span) continue
    found.push({
      start: span.start,
      end: span.end,
      sourceId: query.sourceId,
      sourceIndex: indexById.get(query.sourceId) ?? 0,
      matchType: query.matchType,
    })
  }

  found.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start))
  const kept: HighlightSpan[] = []
  let cursor = 0
  for (const span of found) {
    if (span.start < cursor) continue
    kept.push(span)
    cursor = span.end
  }
  return kept
}
