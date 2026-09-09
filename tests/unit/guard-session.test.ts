import { describe, expect, it } from "vitest"
import {
  resolveSessionCookieSecure,
  sessionCookieOptions,
  signGuardSessionCookie,
  verifyGuardSessionCookie,
} from "@/lib/guard-session.node"
import { GUARD_SESSION_COOKIE } from "@/lib/guard-session.constants"

describe("guard session cookie", () => {
  it("exports the cookie name used by API", () => {
    expect(GUARD_SESSION_COOKIE).toBe("guard_session")
  })

  it("signs and verifies a session token", () => {
    const token = signGuardSessionCookie("7123456", "student")
    const payload = verifyGuardSessionCookie(token)
    expect(payload?.sub).toBe("7123456")
    expect(payload?.role).toBe("student")
    expect(payload?.exp).toBeGreaterThan(Date.now())
  })

  it("rejects a tampered signature", () => {
    const token = signGuardSessionCookie("7123456", "student")
    const [payload] = token.split(".")
    expect(verifyGuardSessionCookie(`${payload}.AAAA`)).toBeNull()
    expect(verifyGuardSessionCookie("not-a-token")).toBeNull()
    expect(verifyGuardSessionCookie("")).toBeNull()
  })

  it("stores additional roles in the payload", () => {
    const token = signGuardSessionCookie("admin1", "admin", ["superadmin"])
    expect(verifyGuardSessionCookie(token)?.ar).toEqual(["superadmin"])
  })

  it("sets httpOnly / sameSite cookie flags", () => {
    const opts = sessionCookieOptions(undefined, 60)
    expect(opts.httpOnly).toBe(true)
    expect(opts.sameSite).toBe("lax")
    expect(opts.path).toBe("/")
    expect(opts.maxAge).toBe(60)
  })

  it("treats x-forwarded-proto https as secure", () => {
    const request = { headers: { get: (name: string) => (name === "x-forwarded-proto" ? "https" : null) } }
    expect(resolveSessionCookieSecure(request)).toBe(true)
  })
})
