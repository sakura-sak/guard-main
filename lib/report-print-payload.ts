import type { NextRequest } from "next/server"
import { getDocumentByIdFromDb, getDocumentAuthorLabel } from "@/lib/local-storage"
import { getDocumentMatchesData, resolveDocumentInstitution } from "@/lib/document-matches-data"
import { buildReportPrintSources, resolveDocumentTypeLabel } from "@/lib/report-print-sources"
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
  ai: number
  sources: Awaited<ReturnType<typeof buildReportPrintSources>>
  verifyUrl: string
  originalUrl: string
  verifyQrImage: string
  originalQrImage: string
  logoUrl: string
}

export async function buildReportPrintPayload(
  documentId: number,
  baseUrl: string,
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
  const ai = Math.round(matchesData.aiPercent ?? 0)

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
  }
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
