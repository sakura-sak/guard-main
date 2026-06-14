/**
 * Проверка той же подписи, что и в guard-session.node.ts (Edge / middleware, Web Crypto).
 */

import type { GuardSessionPayload } from "./guard-session.types"

function base64UrlToUint8Array(s: string): Uint8Array {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/")
  const padLen = (4 - (padded.length % 4)) % 4
  const base64 = padded + "=".repeat(padLen)
  const binary = atob(base64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

function timingSafeEqualUint8(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!
  return diff === 0
}

export async function verifyGuardSessionCookieEdge(
  token: string,
  secret: string,
): Promise<GuardSessionPayload | null> {
  try {
    const dot = token.indexOf(".")
    if (dot <= 0) return null
    const payloadB64 = token.slice(0, dot)
    const sigB64 = token.slice(dot + 1)
    if (!payloadB64 || !sigB64) return null

    const enc = new TextEncoder()
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    )
    const signatureBuf = await crypto.subtle.sign("HMAC", key, enc.encode(payloadB64))
    const expected = new Uint8Array(signatureBuf)
    const actual = base64UrlToUint8Array(sigB64)
    if (!timingSafeEqualUint8(actual, expected)) return null

    const json = JSON.parse(new TextDecoder().decode(base64UrlToUint8Array(payloadB64))) as GuardSessionPayload
    if (typeof json.exp !== "number" || json.exp < Date.now() || typeof json.sub !== "string") return null
    return json
  } catch {
    return null
  }
}
