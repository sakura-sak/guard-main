/**
 * Клиент к Python-сервису анализа (Qdrant + эвристики AI).
 * Включается переменной ANALYSIS_SERVICE_URL.
 */

import http from "http"
import https from "https"
import { URL } from "url"
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

export class MlAnalysisError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
    public readonly statusCode?: number,
  ) {
    super(message)
    this.name = "MlAnalysisError"
  }
}

type HttpJsonResponse = {
  ok: boolean
  status: number
  text: () => Promise<string>
  json: () => Promise<unknown>
}

/**
 * Long-running POST that respects timeoutMs end-to-end.
 * Native fetch/undici aborts around ~300s waiting for response headers
 * (UND_ERR_HEADERS_TIMEOUT) even when AbortController allows longer.
 */
function postJsonWithTimeout(
  url: string,
  headers: Record<string, string>,
  body: string,
  timeoutMs: number,
): Promise<HttpJsonResponse> {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const lib = u.protocol === "https:" ? https : http
    const req = lib.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: `${u.pathname}${u.search}`,
        method: "POST",
        headers: {
          ...headers,
          "Content-Length": Buffer.byteLength(body),
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on("data", (chunk: Buffer) => chunks.push(chunk))
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8")
          const status = res.statusCode || 0
          resolve({
            ok: status >= 200 && status < 300,
            status,
            text: async () => raw,
            json: async () => JSON.parse(raw),
          })
        })
      },
    )
    req.on("timeout", () => {
      req.destroy(new Error(`ML request timed out after ${timeoutMs}ms`))
    })
    req.on("error", reject)
    req.write(body)
    req.end()
  })
}

/**
 * Синхронный анализ текста на стороне ML-сервиса (для worker / диагностики).
 * institutionId → university_id (очередь анализа в plagiarism_psql).
 * При ошибке бросает MlAnalysisError (worker делает retry); analyzeWithMlService ловит и возвращает null.
 */
export async function analyzeWithMlServiceOrThrow(
  content: string,
  options?: {
    filename?: string
    documentId?: number
    institutionId?: string
    category?: string
    userId?: string
    excludeDocumentIds?: number[]
    timeoutMs?: number
  },
): Promise<MlAnalysisResult> {
  const base = getServiceUrl()
  if (!base) {
    throw new MlAnalysisError("ANALYSIS_SERVICE_URL is not configured", false)
  }

  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
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
    if (options?.category) payload.category = options.category
    if (options?.userId) payload.user_id = options.userId
    if (options?.excludeDocumentIds?.length) {
      payload.exclude_document_ids = options.excludeDocumentIds.filter((id) => Number.isFinite(id) && id > 0)
    }

    const res = await postJsonWithTimeout(
      `${base}/v1/analyze`,
      headers,
      JSON.stringify(payload),
      timeoutMs,
    )

    if (!res.ok) {
      const text = await res.text().catch(() => "")
      logError("ML-сервис вернул ошибку", `HTTP ${res.status}: ${text.slice(0, 500)}`, undefined, undefined, "analysis_request", {
        url: `${base}/v1/analyze`,
        filename: options?.filename ?? "document.txt",
        documentId: options?.documentId ?? null,
        durationMs: Date.now() - startedAt,
      })
      const retryable = res.status === 503 || res.status === 429 || res.status >= 500
      throw new MlAnalysisError(`HTTP ${res.status}: ${text.slice(0, 300)}`, retryable, res.status)
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
      throw new MlAnalysisError("Unexpected ML response shape", true)
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
    if (e instanceof MlAnalysisError) throw e
    const msg = e instanceof Error ? e.message : String(e)
    const aborted = /timed out/i.test(msg)
    logError("Запрос в ML-сервис не выполнен", e instanceof Error ? e : String(e), undefined, undefined, "analysis_request", {
      url: `${base}/v1/analyze`,
      filename: options?.filename ?? "document.txt",
      documentId: options?.documentId ?? null,
      durationMs: Date.now() - startedAt,
    })
    throw new MlAnalysisError(aborted ? "ML request timed out" : msg, true)
  }
}

/**
 * Совместимый wrapper: при ошибке возвращает null (старый sync-путь /api/check).
 */
export async function analyzeWithMlService(
  content: string,
  options?: {
    filename?: string
    documentId?: number
    institutionId?: string
    category?: string
    userId?: string
    excludeDocumentIds?: number[]
    timeoutMs?: number
  },
): Promise<MlAnalysisResult | null> {
  try {
    return await analyzeWithMlServiceOrThrow(content, options)
  } catch {
    return null
  }
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  const apiKey = getApiKey()
  if (apiKey) headers["X-API-Key"] = apiKey
  return headers
}

function requestJson(
  method: "GET" | "POST",
  url: string,
  body: string | null,
  timeoutMs: number,
): Promise<HttpJsonResponse> {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const lib = u.protocol === "https:" ? https : http
    const headers: Record<string, string> = authHeaders()
    if (body != null) headers["Content-Length"] = String(Buffer.byteLength(body))
    const req = lib.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: `${u.pathname}${u.search}`,
        method,
        headers,
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on("data", (chunk: Buffer) => chunks.push(chunk))
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8")
          const status = res.statusCode || 0
          resolve({
            ok: status >= 200 && status < 300,
            status,
            text: async () => raw,
            json: async () => (raw ? JSON.parse(raw) : {}),
          })
        })
      },
    )
    req.on("timeout", () => {
      req.destroy(new Error(`ML request timed out after ${timeoutMs}ms`))
    })
    req.on("error", reject)
    if (body != null) req.write(body)
    req.end()
  })
}

export type MlJobStatus = {
  jobId: string
  status: "queued" | "processing" | "completed" | "failed" | string
  result?: MlAnalysisResult
  error?: string | null
}

/** Submit analysis to ML async queue; returns immediately with job_id. */
export async function submitMlJob(options: {
  content: string
  filename?: string
  documentId?: number
  institutionId?: string
  category?: string
  userId?: string
  excludeDocumentIds?: number[]
}): Promise<string> {
  const base = getServiceUrl()
  if (!base) throw new MlAnalysisError("ANALYSIS_SERVICE_URL is not configured", false)

  const payload: Record<string, unknown> = {
    content: options.content,
    filename: options.filename ?? "document.txt",
    document_id: options.documentId,
  }
  if (options.institutionId) payload.university_id = options.institutionId
  if (options.category) payload.category = options.category
  if (options.userId) payload.user_id = options.userId
  if (options.excludeDocumentIds?.length) {
    payload.exclude_document_ids = options.excludeDocumentIds.filter((id) => Number.isFinite(id) && id > 0)
  }

  const res = await requestJson("POST", `${base}/v1/jobs`, JSON.stringify(payload), 120_000)
  if (res.status === 404) {
    throw new MlAnalysisError("ML /v1/jobs not found — rebuild/restart analysis service", false, 404)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    const retryable = res.status === 503 || res.status === 429 || res.status >= 500
    throw new MlAnalysisError(`Submit failed HTTP ${res.status}: ${text.slice(0, 300)}`, retryable, res.status)
  }
  const data = (await res.json()) as { job_id?: string }
  if (!data.job_id) throw new MlAnalysisError("ML submit response missing job_id", true)
  logInfo("ML job submitted", undefined, undefined, "analysis_request", {
    mlJobId: data.job_id,
    documentId: options.documentId ?? null,
    universityId: options.institutionId ?? null,
    userId: options.userId ?? null,
    excludeDocumentCount: options.excludeDocumentIds?.length ?? 0,
    category: options.category ?? null,
    contentChars: options.content.length,
  })
  return data.job_id
}

/** Short poll of ML async job status. */
export async function getMlJob(mlJobId: string): Promise<MlJobStatus> {
  const base = getServiceUrl()
  if (!base) throw new MlAnalysisError("ANALYSIS_SERVICE_URL is not configured", false)

  const res = await requestJson("GET", `${base}/v1/jobs/${encodeURIComponent(mlJobId)}`, null, 60_000)
  if (res.status === 404) {
    throw new MlAnalysisError("ML job not found", true, 404)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    const retryable = res.status === 503 || res.status >= 500
    throw new MlAnalysisError(`Poll failed HTTP ${res.status}: ${text.slice(0, 300)}`, retryable, res.status)
  }
  const data = (await res.json()) as {
    job_id: string
    status: string
    error?: string | null
    result?: {
      plagiarism_percent?: number
      ai_percent?: number
      semantic_matches?: unknown
      by_type?: unknown
    } | null
  }

  let result: MlAnalysisResult | undefined
  if (data.status === "completed" && data.result) {
    if (typeof data.result.plagiarism_percent !== "number" || typeof data.result.ai_percent !== "number") {
      throw new MlAnalysisError("Unexpected ML job result shape", true)
    }
    result = {
      plagiarismPercent: data.result.plagiarism_percent,
      aiPercent: data.result.ai_percent,
      semanticMatches: normalizeMlSemanticMatches(data.result.semantic_matches),
      byType: parseByType(data.result.by_type),
    }
  }

  return {
    jobId: data.job_id,
    status: data.status,
    result,
    error: data.error ?? null,
  }
}

