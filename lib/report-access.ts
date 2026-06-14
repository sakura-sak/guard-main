/**
 * Защита доступа к отчётам и оригиналам по QR-ссылкам.
 * URL содержат подпись HMAC; без валидной подписи доступ запрещён.
 * Исключает доступ к чужим документам при подмене ID в ссылке.
 *
 * В продакшене задайте REPORT_ACCESS_SECRET (≥16 символов) в .env.
 */

import crypto from "crypto"

const ALG = "sha256"
const PREFIX = "report-access"

function getSecret(): string {
  const s = process.env.REPORT_ACCESS_SECRET
  if (s && s.length >= 16) return s
  return "dev-secret-change-in-production"
}

function payload(type: "report" | "original", documentId: number): string {
  return `${PREFIX}:${type}:${documentId}`
}

/**
 * Создаёт подпись для доступа к отчёту или оригиналу.
 * Подставляется в QR-ссылки при генерации PDF.
 */
export function signDocumentAccess(type: "report" | "original", documentId: number): string {
  const secret = getSecret()
  const msg = payload(type, documentId)
  return crypto.createHmac(ALG, secret).update(msg).digest("base64url")
}

/**
 * Проверяет подпись. Возвращает true только если sig совпадает с ожидаемой.
 * Сравнение по времени-константное, чтобы исключить тайминг-атаки.
 */
export function verifyDocumentAccess(
  type: "report" | "original",
  documentId: number,
  sig: string,
): boolean {
  if (!sig || typeof sig !== "string" || sig.length > 200) return false
  const expected = signDocumentAccess(type, documentId)
  try {
    const a = Buffer.from(sig, "base64url")
    const b = Buffer.from(expected, "base64url")
    return a.length === b.length && crypto.timingSafeEqual(a, b)
  } catch {
    return false
  }
}
