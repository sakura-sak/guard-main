import { describe, expect, it, vi } from "vitest"
import {
  resolveSessionCookieSecure,
  sessionCookieOptions,
  signGuardSessionCookie,
  verifyGuardSessionCookie,
  getSessionIdleTimeoutSec,
  getSessionCookieMaxAgeSec,
  DEFAULT_SESSION_IDLE_TIMEOUT_SEC,
  DEFAULT_SESSION_MAX_AGE_SEC,
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

  it("stores last activity in the payload", () => {
    const token = signGuardSessionCookie("7123456", "student")
    const payload = verifyGuardSessionCookie(token)
    expect(payload?.act).toBeGreaterThan(Date.now() - 5000)
  })

  it("reads idle timeout from env (default 2 hours, 0 disables)", () => {
    vi.stubEnv("SESSION_IDLE_TIMEOUT_SEC", "")
    expect(getSessionIdleTimeoutSec()).toBe(DEFAULT_SESSION_IDLE_TIMEOUT_SEC)
    expect(getSessionCookieMaxAgeSec()).toBe(DEFAULT_SESSION_IDLE_TIMEOUT_SEC)

    vi.stubEnv("SESSION_IDLE_TIMEOUT_SEC", "0")
    expect(getSessionIdleTimeoutSec()).toBe(0)
    expect(getSessionCookieMaxAgeSec()).toBe(DEFAULT_SESSION_MAX_AGE_SEC)

    vi.stubEnv("SESSION_IDLE_TIMEOUT_SEC", "1800")
    expect(getSessionIdleTimeoutSec()).toBe(1800)
    expect(getSessionCookieMaxAgeSec()).toBe(1800)
  })
})
