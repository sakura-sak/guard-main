import type { NextRequest } from "next/server"
import { getDocumentByIdFromDb, getDocumentAuthorLabel } from "@/lib/local-storage"
import { getDocumentMatchesData, resolveDocumentInstitution } from "@/lib/document-matches-data"
import { buildReportPrintSources, resolveDocumentTypeLabel } from "@/lib/report-print-sources"
import { MATCH_TYPE_LABELS } from "@/lib/ml-matches-storage"
import { buildReportQrLinks, resolvePublicBaseUrl } from "@/lib/report-qr-links"
import { qrPngDataUrl } from "@/lib/report-qr-images"

export type ReportPrintPayload = {
  reportId: number
  title: string
  author: string
  institution: string
  type: string
  wordCount: number | null
  savedAt: string
  orig: number
  matches: number
  ai: number | null
  sources: Awaited<ReturnType<typeof buildReportPrintSources>>
  verifyUrl: string
  originalUrl: string
  verifyQrImage: string
  originalQrImage: string
  logoUrl: string
  /** Только полный отчёт. В кратком ответе поля нет. */
  fullReport?: FullReportBlock
}

export type FullReportFragment = {
  queryText: string
  sourceText: string
  matchType: string
  matchTypeLabel: string
}

export type FullReportSource = {
  index: number
  title: string
  docId: string
  author: string
  docType: string
  date: string | null
  percent: number
  fragments: FullReportFragment[]
}

export type FullReportBlock = {
  sources: FullReportSource[]
}

export async function buildReportPrintPayload(
  documentId: number,
  baseUrl: string,
  options?: { full?: boolean },
): Promise<ReportPrintPayload | null> {
  const doc = await getDocumentByIdFromDb(documentId)
  if (!doc) return null

  const matchesData = await getDocumentMatchesData(documentId)
  if (!matchesData) return null

  const sources = await buildReportPrintSources(matchesData)
  const typeLabel = await resolveDocumentTypeLabel(doc.category)
  const links = buildReportQrLinks(documentId, baseUrl)
  const [verifyQrImage, originalQrImage] = await Promise.all([
    qrPngDataUrl(links.verifyUrl),
    qrPngDataUrl(links.originalUrl),
  ])

  const orig = Math.round(matchesData.originalityPercent)
  const matches = Math.round(matchesData.plagiarismPercent)
  const ai = matchesData.aiPercent == null ? null : Math.round(matchesData.aiPercent)

  return {
    reportId: doc.id,
    title: doc.title || "—",
    author: getDocumentAuthorLabel(doc),
    institution: resolveDocumentInstitution(doc),
    type: typeLabel,
    wordCount: doc.wordCount ?? null,
    savedAt: doc.uploadDate || new Date().toISOString(),
    orig,
    matches,
    ai,
    sources,
    verifyUrl: links.verifyUrl,
    originalUrl: links.originalUrl,
    verifyQrImage,
    originalQrImage,
    logoUrl: "/bsuir-logo.jpg",
    ...(options?.full
      ? {
          fullReport: buildFullReportBlock(matchesData),
        }
      : {}),
  }
}

function fragmentsForPrint(
  match: NonNullable<Awaited<ReturnType<typeof getDocumentMatchesData>>>["borrowMatches"][number],
): FullReportFragment[] {
  const stored = (match.fragments || []).filter(
    (fragment) => (fragment.sourceText || fragment.queryText || "").trim(),
  )
  if (stored.length) {
    return stored.map((fragment) => ({
      queryText: fragment.queryText,
      sourceText: fragment.sourceText,
      matchType: fragment.matchType,
      matchTypeLabel: MATCH_TYPE_LABELS[fragment.matchType] || fragment.matchType,
    }))
  }
  const quote = (match.quote || "").trim()
  if (!quote || quote.startsWith("Структурное сходство")) return []
  return [{
    queryText: quote,
    sourceText: quote,
    matchType: match.matchType,
    matchTypeLabel: match.matchTypeLabel || MATCH_TYPE_LABELS[match.matchType] || match.matchType,
  }]
}

function buildFullReportBlock(
  data: NonNullable<Awaited<ReturnType<typeof getDocumentMatchesData>>>,
): FullReportBlock {
  const sources: FullReportSource[] = data.borrowMatches
    .filter((match) => match.sourceId > 0)
    .map((match, index) => ({
      index: index + 1,
      title: match.sourceTitle || "—",
      docId: String(match.sourceId),
      author: match.sourceAuthor || "—",
      docType: match.matchTypeLabel || match.category || "—",
      date: match.sourceDate ?? null,
      percent: Math.round(match.similarity ?? 0),
      fragments: fragmentsForPrint(match),
    }))
  return { sources }
}

export function resolveBaseUrlForReport(request: NextRequest): string {
  const fromHelper = resolvePublicBaseUrl(request)
  if (fromHelper) return fromHelper
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim()
    ?? request.headers.get("host")?.trim()
  if (!host) return ""
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https" ? "https" : "http"
  return `${proto}://${host}`.replace(/\/$/, "")
}
