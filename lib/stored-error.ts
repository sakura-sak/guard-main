/** Machine-readable check errors shared with the Moodle plugin. */

const KNOWN = new Set([
  "unavailable",
  "timeout",
  "overloaded",
  "unsupported_format",
  "corrupted_file",
  "no_text",
  "extraction_failed",
  "internal",
  "result_transfer",
  "auth",
])

export function formatStoredError(code: string, message: string): string {
  const safe = KNOWN.has(code) ? code : "internal"
  return `${safe}|${message}`.slice(0, 2000)
}

export function parseStoredError(raw: string | null | undefined): { errorCode: string; error: string } {
  if (!raw) return { errorCode: "internal", error: "" }
  const idx = raw.indexOf("|")
  if (idx > 0) {
    const code = raw.slice(0, idx)
    if (KNOWN.has(code)) return { errorCode: code, error: raw.slice(idx + 1) }
  }
  return { errorCode: inferErrorCode(raw), error: raw }
}

export function inferErrorCode(text: string): string {
  const lower = text.toLowerCase()
  if (lower.includes("timeout") || lower.includes("timed out") || /\b(408|504)\b/.test(lower)) return "timeout"
  if (/\b(429|409)\b/.test(lower)) return "overloaded"
  if (/\b(401|403)\b/.test(lower) || lower.includes("api key") || lower.includes("unauthorized")) return "auth"
  if (/\b(502|503)\b/.test(lower) || lower.includes("econnrefused") || lower.includes("fetch failed")) return "unavailable"
  if (lower.includes("коротк") || lower.includes("too short") || lower.includes("не обнаружен текст")) return "no_text"
  return "internal"
}
