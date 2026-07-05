/**
 * Подпись и проверка сессионной cookie (Node: login route и API).
 */

import { createHmac, timingSafeEqual } from "node:crypto"
import type { UserRole } from "./auth"
import { GUARD_SESSION_COOKIE } from "./guard-session.constants"
import type { GuardSessionPayload } from "./guard-session.types"

export { GUARD_SESSION_COOKIE }

type HeaderReader = { headers: { get(name: string): string | null } }

/** Secure flag for session cookie: env override, then X-Forwarded-Proto, else non-production only. */
export function resolveSessionCookieSecure(request?: HeaderReader): boolean {
  const override = process.env.SESSION_COOKIE_SECURE?.trim().toLowerCase()
  if (override === "false" || override === "0" || override === "no") return false
  if (override === "true" || override === "1" || override === "yes") return true
  const proto = request?.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase()
  if (proto) return proto === "https"
  return process.env.NODE_ENV !== "production"
}

export function sessionCookieOptions(
  request: HeaderReader | undefined,
  maxAge: number,
): {
  httpOnly: true
  secure: boolean
  sameSite: "lax"
  path: "/"
  maxAge: number
} {
  return {
    httpOnly: true,
    secure: resolveSessionCookieSecure(request),
    sameSite: "lax",
    path: "/",
    maxAge,
  }
}

function getSecret(): string {
  const s =
    process.env.SESSION_SECRET?.trim() ||
    process.env.REPORT_ACCESS_SECRET?.trim() ||
    "development-only-guard-session-secret-min-16-chars!!"
  if (s.length < 16 && process.env.NODE_ENV === "production") {
    console.warn("[guard-session] SESSION_SECRET слишком короткий или не задан")
  }
  return s
}

export function signGuardSessionCookie(
  username: string,
  role: UserRole | string,
  additionalRoles?: UserRole[],
  maxAgeSec = 60 * 60 * 24 * 7,
): string {
  const secret = getSecret()
  const exp = Date.now() + maxAgeSec * 1000
  const payloadObj: GuardSessionPayload = {
    sub: username,
    exp,
    role,
    ar: additionalRoles?.length ? additionalRoles : undefined,
  }
  const payloadB64 = Buffer.from(JSON.stringify(payloadObj), "utf8").toString("base64url")
  const sig = createHmac("sha256", secret).update(payloadB64).digest("base64url")
  return `${payloadB64}.${sig}`
}

export function verifyGuardSessionCookie(token: string): GuardSessionPayload | null {
  try {
    const secret = getSecret()
    const dot = token.indexOf(".")
    if (dot <= 0) return null
    const payloadB64 = token.slice(0, dot)
    const sig = token.slice(dot + 1)
    if (!payloadB64 || !sig) return null
    const expected = createHmac("sha256", secret).update(payloadB64).digest("base64url")
    const a = Buffer.from(sig, "utf8")
    const b = Buffer.from(expected, "utf8")
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null
    const raw = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as GuardSessionPayload
    if (typeof raw.exp !== "number" || raw.exp < Date.now() || typeof raw.sub !== "string") return null
    return raw
  } catch {
    return null
  }
}

export function buildSessionCookieHeaderValue(token: string): string {
  return token
}
