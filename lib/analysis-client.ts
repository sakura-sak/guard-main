/**
 * Клиент к Python-сервису анализа (Qdrant + эвристики AI).
 * Включается переменной ANALYSIS_SERVICE_URL.
 */

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

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    }
    const apiKey = getApiKey()
    if (apiKey) headers["X-API-Key"] = apiKey

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
      console.error("[analysis-client] ML service error", res.status, text.slice(0, 500))
      return null
    }

    const data = (await res.json()) as {
      plagiarism_percent?: number
      ai_percent?: number
    }
    if (typeof data.plagiarism_percent !== "number" || typeof data.ai_percent !== "number") {
      console.error("[analysis-client] unexpected response shape", data)
      return null
    }

    return {
      plagiarismPercent: data.plagiarism_percent,
      aiPercent: data.ai_percent,
    }
  } catch (e) {
    console.error("[analysis-client] request failed", e)
    return null
  } finally {
    clearTimeout(timer)
  }
}
