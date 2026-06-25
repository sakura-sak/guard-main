/**
 * Клиент к Python-сервису анализа (Qdrant + эвристики AI).
 * Включается переменной ANALYSIS_SERVICE_URL.
 */

import { logError, logInfo } from "@/lib/logger"

export type MlAnalysisResult = {
  plagiarismPercent: number
  aiPercent: number
}

function getServiceUrl(): string | null {
  const u = process.env.ANALYSIS_SERVICE_URL?.trim()
  return u && u.length > 0 ? u.replace(/\/$/, "") : null
}

function getApiKey(): string | undefined {
  const k =
    process.env.ANALYSIS_SERVICE_API_KEY?.trim() ||
    process.env.ANALYSIS_API_KEY?.trim()
  return k && k.length > 0 ? k : undefined
}

const DEFAULT_TIMEOUT_MS = 300_000

/**
 * Синхронный анализ текста на стороне ML-сервиса.
 * При отсутствии URL или ошибке сети возвращает null (Guard работает только на MinHash).
 */
export async function analyzeWithMlService(
  content: string,
  options?: { filename?: string; documentId?: number; timeoutMs?: number },
): Promise<MlAnalysisResult | null> {
  const base = getServiceUrl()
  if (!base) return null

  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const startedAt = Date.now()

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    }
    const apiKey = getApiKey()
    if (apiKey) headers["X-API-Key"] = apiKey

    logInfo("Запрос в ML-сервис анализа", undefined, undefined, "analysis_request", {
      url: `${base}/v1/analyze`,
      filename: options?.filename ?? "document.txt",
      documentId: options?.documentId ?? null,
      contentChars: content.length,
      timeoutMs,
      apiKeyConfigured: Boolean(apiKey),
    })

    const res = await fetch(`${base}/v1/analyze`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        content,
        filename: options?.filename ?? "document.txt",
        document_id: options?.documentId,
      }),
      signal: controller.signal,
    })

    if (!res.ok) {
      const text = await res.text().catch(() => "")
      logError("ML-сервис вернул ошибку", `HTTP ${res.status}: ${text.slice(0, 500)}`, undefined, undefined, "analysis_request", {
        url: `${base}/v1/analyze`,
        filename: options?.filename ?? "document.txt",
        documentId: options?.documentId ?? null,
        durationMs: Date.now() - startedAt,
      })
      return null
    }

    const data = (await res.json()) as {
      plagiarism_percent?: number
      ai_percent?: number
    }
    if (typeof data.plagiarism_percent !== "number" || typeof data.ai_percent !== "number") {
      logError("ML-сервис вернул неожиданный ответ", JSON.stringify(data).slice(0, 500), undefined, undefined, "analysis_request", {
        durationMs: Date.now() - startedAt,
      })
      return null
    }

    logInfo("Ответ ML-сервиса анализа", undefined, undefined, "analysis_response", {
      filename: options?.filename ?? "document.txt",
      documentId: options?.documentId ?? null,
      durationMs: Date.now() - startedAt,
      plagiarismPercent: data.plagiarism_percent,
      aiPercent: data.ai_percent,
    })

    return {
      plagiarismPercent: data.plagiarism_percent,
      aiPercent: data.ai_percent,
    }
  } catch (e) {
    logError("Запрос в ML-сервис не выполнен", e instanceof Error ? e : String(e), undefined, undefined, "analysis_request", {
      url: `${base}/v1/analyze`,
      filename: options?.filename ?? "document.txt",
      documentId: options?.documentId ?? null,
      durationMs: Date.now() - startedAt,
    })
    return null
  } finally {
    clearTimeout(timer)
  }
}
