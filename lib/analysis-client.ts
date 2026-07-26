/**
 * Клиент к Python-сервису анализа (Qdrant + эвристики AI).
 * Включается переменной ANALYSIS_SERVICE_URL.
 */

import { logError, logInfo } from "@/lib/logger"
import {
  normalizeMlSemanticMatches,
  type MlSemanticMatch,
} from "@/lib/ml-matches-storage"

export type MlAnalysisResult = {
  plagiarismPercent: number
  aiPercent: number
  semanticMatches: MlSemanticMatch[]
  byType: { exact: number; paraphrase: number; semantic: number }
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

function emptyByType() {
  return { exact: 0, paraphrase: 0, semantic: 0 }
}

function parseByType(raw: unknown): MlAnalysisResult["byType"] {
  if (!raw || typeof raw !== "object") return emptyByType()
  const o = raw as Record<string, unknown>
  return {
    exact: Number(o.exact) || 0,
    paraphrase: Number(o.paraphrase) || 0,
    semantic: Number(o.semantic) || 0,
  }
}

/**
 * Синхронный анализ текста на стороне ML-сервиса.
 * При отсутствии URL или ошибке сети возвращает null (Guard работает только на MinHash).
 * institutionId → university_id (очередь анализа в plagiarism_psql).
 */
export async function analyzeWithMlService(
  content: string,
  options?: { filename?: string; documentId?: number; institutionId?: string; timeoutMs?: number },
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
      universityId: options?.institutionId ?? null,
      contentChars: content.length,
      timeoutMs,
      apiKeyConfigured: Boolean(apiKey),
    })

    const payload: Record<string, unknown> = {
      content,
      filename: options?.filename ?? "document.txt",
      document_id: options?.documentId,
    }
    if (options?.institutionId) payload.university_id = options.institutionId

    const res = await fetch(`${base}/v1/analyze`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
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
      semantic_matches?: unknown
      by_type?: unknown
    }
    if (typeof data.plagiarism_percent !== "number" || typeof data.ai_percent !== "number") {
      logError("ML-сервис вернул неожиданный ответ", JSON.stringify(data).slice(0, 500), undefined, undefined, "analysis_request", {
        durationMs: Date.now() - startedAt,
      })
      return null
    }

    const semanticMatches = normalizeMlSemanticMatches(data.semantic_matches)
    const byType = parseByType(data.by_type)

    logInfo("Ответ ML-сервиса анализа", undefined, undefined, "analysis_response", {
      filename: options?.filename ?? "document.txt",
      documentId: options?.documentId ?? null,
      durationMs: Date.now() - startedAt,
      plagiarismPercent: data.plagiarism_percent,
      aiPercent: data.ai_percent,
      semanticMatchCount: semanticMatches.length,
      byType,
    })

    return {
      plagiarismPercent: data.plagiarism_percent,
      aiPercent: data.ai_percent,
      semanticMatches,
      byType,
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
