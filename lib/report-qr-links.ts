import type { NextRequest } from "next/server"
import { signDocumentAccess } from "@/lib/report-access"

function stripTrailingSlash(url: string): string {
  return url.replace(/\/$/, "")
}

function isLoopback(urlOrHostish: string): boolean {
  const s = urlOrHostish.toLowerCase()
  return s.includes("localhost") || s.includes("127.0.0.1")
}

/** Публичный базовый URL для QR (без завершающего /). */
export function resolvePublicBaseUrl(request?: NextRequest): string {
  const reportPublic = process.env.REPORT_PUBLIC_BASE_URL?.trim()
  if (reportPublic && !isLoopback(reportPublic)) {
    return stripTrailingSlash(reportPublic)
  }

  if (request) {
    const hostRaw = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim()
      ?? request.headers.get("host")?.trim()
    const protoRaw = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? "http"
    const proto = protoRaw === "https" ? "https" : "http"
    if (hostRaw) {
      const withoutDefaultPort =
        proto === "http" && hostRaw.endsWith(":80")
          ? hostRaw.slice(0, -3)
          : proto === "https" && hostRaw.endsWith(":443")
            ? hostRaw.slice(0, -4)
            : hostRaw
      if (!isLoopback(withoutDefaultPort)) {
        return stripTrailingSlash(`${proto}://${withoutDefaultPort}`)
      }
    }
  }

  const fromEnv = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (fromEnv && !isLoopback(fromEnv)) {
    return stripTrailingSlash(fromEnv)
  }

  // Локальная разработка: QR ведут на тот же host, с которого открыт сайт
  if (request) {
    const hostRaw = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim()
      ?? request.headers.get("host")?.trim()
    const protoRaw = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? "http"
    const proto = protoRaw === "https" ? "https" : "http"
    if (hostRaw) {
      return stripTrailingSlash(`${proto}://${hostRaw}`)
    }
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
  const reportQuery = `documentId=${documentId}&sig=${encodeURIComponent(sigReport)}`
  return {
    verifyUrl: `${base}/report.html?${reportQuery}`,
    originalUrl: `${base}/api/report/${documentId}/original?sig=${encodeURIComponent(sigOriginal)}`,
    reportPdfUrl: `${base}/report.html?${reportQuery}`,
  }
}
