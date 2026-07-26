import { getAllDocumentTypes, getDocumentTypesForInstitution } from "@/lib/document-types"
import type { DocumentMatchesPayload } from "@/lib/document-matches-data"

export type ReportPrintSourceRow = {
  title: string
  docType: string
  docId: string
  percent: number
  percentLabel: string
}

async function categoryLabelMap(institutionId?: string | null): Promise<Map<string, string>> {
  const types = institutionId
    ? await getDocumentTypesForInstitution(institutionId, true)
    : await getAllDocumentTypes(true)
  const map = new Map<string, string>()
  for (const t of types) {
    if (t.name) map.set(t.name, t.displayName || t.name)
  }
  return map
}

function mapBorrowRows(
  data: DocumentMatchesPayload,
  labels: Map<string, string>,
): ReportPrintSourceRow[] {
  const simById = new Map(data.similarDocuments.map((s) => [s.id, s]))
  const rows: ReportPrintSourceRow[] = []
  for (const m of data.borrowMatches) {
    if (!m.sourceId || m.sourceId <= 0) continue
    const sim = simById.get(m.sourceId)
    const pct = Math.round(m.similarity ?? 0)
    rows.push({
      title: m.sourceTitle || "—",
      docId: String(m.sourceId),
      docType: (sim?.category && labels.get(sim.category)) || sim?.category || "—",
      percent: pct,
      percentLabel: `${pct}%`,
    })
  }
  return rows.slice(0, 5)
}

/** Same fallback rows as ApApi.buildReportTableRows in public/api.js */
export function buildReportTableRows(
  rows: ReportPrintSourceRow[],
  stats: { matches: number; ml: number; local: number },
): ReportPrintSourceRow[] {
  if (rows.length) return rows
  const matches = stats.matches ?? 0
  const ml = stats.ml ?? 0
  const local = stats.local ?? 0
  if (matches > 0) {
    const viaMl = ml >= local && ml > 0
    return [{
      title: viaMl ? "Семантический анализ" : "Итоговая оценка",
      docType: "—",
      docId: "—",
      percent: matches,
      percentLabel: `${matches}%`,
    }]
  }
  return [{
    title: "Заимствования не обнаружены",
    docType: "—",
    docId: "—",
    percent: 0,
    percentLabel: "0%",
  }]
}

export async function buildReportPrintSources(data: DocumentMatchesPayload): Promise<ReportPrintSourceRow[]> {
  const labels = await categoryLabelMap()
  const rows = mapBorrowRows(data, labels)
  return buildReportTableRows(rows, {
    matches: Math.round(data.plagiarismPercent),
    ml: Math.round(data.mlPlagiarismPercent),
    local: Math.round(data.localPlagiarismPercent),
  })
}

export async function resolveDocumentTypeLabel(
  category?: string | null,
  institutionId?: string | null,
): Promise<string> {
  if (!category) return "—"
  const labels = await categoryLabelMap(institutionId)
  return labels.get(category) || category
}
