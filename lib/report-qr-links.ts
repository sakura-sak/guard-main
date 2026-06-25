import type { NextRequest } from "next/server"
import { signDocumentAccess } from "@/lib/report-access"

/** Публичный базовый URL для QR (без завершающего /). */
export function resolvePublicBaseUrl(request?: NextRequest): string {
  const fromEnv =
    process.env.REPORT_PUBLIC_BASE_URL?.trim() || process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (fromEnv) return fromEnv.replace(/\/$/, "")
  if (request) {
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host")
    const proto = request.headers.get("x-forwarded-proto") ?? "http"
    if (host) return `${proto === "https" ? "https" : "http"}://${host}`.replace(/\/$/, "")
  }
  return ""
}

export type ReportQrLinks = {
  verifyUrl: string
  originalUrl: string
  reportPdfUrl: string
}

/**
 * Подписанные ссылки для двух QR на справке:
 * 1) верификация подлинности; 2) оригинальный загруженный файл.
 */
export function buildReportQrLinks(documentId: number, baseUrl: string): ReportQrLinks {
  const base = baseUrl.replace(/\/$/, "")
  const sigReport = signDocumentAccess("report", documentId)
  const sigOriginal = signDocumentAccess("original", documentId)
  return {
    verifyUrl: `${base}/api/report/v/${documentId}/${encodeURIComponent(sigReport)}`,
    originalUrl: `${base}/api/report/${documentId}/original?sig=${encodeURIComponent(sigOriginal)}`,
    reportPdfUrl: `${base}/api/report/${documentId}/view?sig=${encodeURIComponent(sigReport)}`,
  }
}
