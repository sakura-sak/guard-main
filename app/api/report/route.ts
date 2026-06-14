import { type NextRequest, NextResponse } from "next/server"
import { generatePDFReport } from "@/lib/pdf-report"
import { saveReportPdf } from "@/lib/local-storage"
import { logInfo } from "@/lib/logger"
import { getSimilarDocumentsForReport } from "@/lib/similar-documents-for-report"

const DEFAULT_REPORT_BASE_URL = "http://172.16.82.130:3000"

function stripTrailingSlash(url: string): string {
  return url.replace(/\/$/, "")
}

function isLoopback(urlOrHostish: string): boolean {
  const s = urlOrHostish.toLowerCase()
  return s.includes("localhost") || s.includes("127.0.0.1")
}

/** Базовый URL в QR справки: явный REPORT_PUBLIC_* → Host запроса (как пользователь открыл сайт) → NEXT_PUBLIC_* → дефолт IP. */
function getBaseUrl(request: NextRequest): string {
  const reportPublic = process.env.REPORT_PUBLIC_BASE_URL?.trim()
  if (reportPublic && !isLoopback(reportPublic)) {
    return stripTrailingSlash(reportPublic)
  }

  const hostRaw = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim()
    ?? request.headers.get("host")?.trim()
  const protoRaw = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? "http"
  const proto = protoRaw === "https" ? "https" : "http"

  if (hostRaw && !isLoopback(hostRaw)) {
    const withoutDefaultPort =
      proto === "http" && hostRaw.endsWith(":80")
        ? hostRaw.slice(0, -3)
        : proto === "https" && hostRaw.endsWith(":443")
          ? hostRaw.slice(0, -4)
          : hostRaw
    return stripTrailingSlash(`${proto}://${withoutDefaultPort}`)
  }

  const nextPublic = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (nextPublic && !isLoopback(nextPublic)) {
    return stripTrailingSlash(nextPublic)
  }

  return DEFAULT_REPORT_BASE_URL
}

// POST - Генерация PDF отчета
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const result = body

    if (!result || !result.filename || result.uniquenessPercent === undefined) {
      return NextResponse.json({ success: false, error: "Недостаточно данных для генерации отчета" }, { status: 400 })
    }

    // Всегда используем серверную функцию getBaseUrl, игнорируя baseUrl с клиента
    // чтобы избежать проблем с localhost на сервере
    const baseUrl = getBaseUrl(request)

    let similarDocuments = Array.isArray(result.similarDocuments) ? result.similarDocuments : []
    const docId = typeof result.documentId === "number" ? result.documentId : undefined
    if (docId && similarDocuments.length === 0) {
      try {
        similarDocuments = await getSimilarDocumentsForReport(docId)
      } catch {
        /* оставляем пустым — pdf-report покажет пояснение / метрики */
      }
    }

    const payload = {
      ...result,
      similarDocuments,
      checker: result.checker ?? undefined,
      baseUrl,
    }

    const pdfBytes = await generatePDFReport(payload)
    const pdfBuffer = Buffer.from(pdfBytes)

    const isFinal = result.status === "final" && result.documentId
    if (isFinal) {
      saveReportPdf(result.documentId, pdfBuffer, result.uniquenessPercent)
    }

    logInfo("PDF отчет сгенерирован", result.userId, result.userRole, "generate_report", {
      filename: result.filename,
      uniquenessPercent: result.uniquenessPercent,
      documentId: result.documentId,
      stored: isFinal,
    })

    const base = result.filename.replace(/\.[^/.]+$/, "")
    const safeBase = base.replace(/[^\x00-\x7F]/g, "_").replace(/_{2,}/g, "_") || "document"
    const fn = isFinal ? `spravka-${safeBase}.pdf` : `report-${safeBase}.pdf`

    return new NextResponse(pdfBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${fn}"`,
      },
    })
  } catch (error) {
    console.error("Error generating PDF report:", error)
    return NextResponse.json({ success: false, error: "Ошибка при генерации отчета" }, { status: 500 })
  }
}
