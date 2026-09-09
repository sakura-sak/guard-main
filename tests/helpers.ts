import { NextRequest } from "next/server"
import { GUARD_SESSION_COOKIE } from "@/lib/guard-session.constants"
import { signGuardSessionCookie } from "@/lib/guard-session.node"
import type { UserRole } from "@/lib/auth"

export function jsonRequest(
  url: string,
  body: unknown,
  method = "POST",
  cookie?: string,
): NextRequest {
  const headers = new Headers({ "content-type": "application/json" })
  if (cookie) headers.set("cookie", cookie)
  return new NextRequest(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

export function getRequest(url: string, cookie?: string): NextRequest {
  const headers = new Headers()
  if (cookie) headers.set("cookie", cookie)
  return new NextRequest(url, { method: "GET", headers })
}

export function sessionCookie(username: string, role: UserRole, additionalRoles?: UserRole[]): string {
  const token = signGuardSessionCookie(username, role, additionalRoles)
  return `${GUARD_SESSION_COOKIE}=${token}`
}
