import { beforeEach, describe, expect, it, vi } from "vitest"
import { createHmac } from "node:crypto"
import { getRequest, sessionCookie } from "../helpers"
import { GUARD_SESSION_COOKIE } from "@/lib/guard-session.constants"
import { signGuardSessionCookie } from "@/lib/guard-session.node"

const getUserByUsername = vi.fn()

vi.mock("@/lib/user-storage", () => ({
  getUserByUsername: (...args: unknown[]) => getUserByUsername(...args),
}))

import { requireSessionApi } from "@/lib/require-session-api"

function cookieHeader(token: string): string {
  return `${GUARD_SESSION_COOKIE}=${token}`
}

function legacyCookieWithoutAct(username: string, role: string): string {
  const secret =
    process.env.SESSION_SECRET?.trim() ||
    process.env.REPORT_ACCESS_SECRET?.trim() ||
    "development-only-guard-session-secret-min-16-chars!!"
  const payloadB64 = Buffer.from(
    JSON.stringify({ sub: username, exp: Date.now() + 3600_000, role }),
    "utf8",
  ).toString("base64url")
  const sig = createHmac("sha256", secret).update(payloadB64).digest("base64url")
  return cookieHeader(`${payloadB64}.${sig}`)
}

describe("requireSessionApi", () => {
  beforeEach(() => {
    getUserByUsername.mockReset()
    vi.stubEnv("SESSION_IDLE_TIMEOUT_SEC", "7200")
  })

  it("returns 401 when cookie is missing", async () => {
    const gate = await requireSessionApi(getRequest("http://antiplagiat.bsuir.by/api/auth/me"))
    expect(gate.ok).toBe(false)
    if (!gate.ok) {
      expect(gate.response.status).toBe(401)
      const body = await gate.response.json()
      expect(body.error).toBe("Требуется вход")
    }
  })

  it("returns 401 when cookie is invalid", async () => {
    const gate = await requireSessionApi(
      getRequest("http://antiplagiat.bsuir.by/api/auth/me", "guard_session=broken.token"),
    )
    expect(gate.ok).toBe(false)
    if (!gate.ok) {
      expect(gate.response.status).toBe(401)
      const body = await gate.response.json()
      expect(body.error).toBe("Сессия недействительна или истекла")
    }
  })

  it("loads the user from the database after a valid cookie", async () => {
    getUserByUsername.mockResolvedValue({
      username: "7123456",
      role: "student",
      additionalRoles: [],
      institutionId: "bsuir",
      faculty: "ФКСиС",
      group: "050501",
    })
    const gate = await requireSessionApi(
      getRequest("http://antiplagiat.bsuir.by/api/auth/me", sessionCookie("7123456", "student")),
    )
    expect(gate.ok).toBe(true)
    if (gate.ok) {
      expect(gate.user.username).toBe("7123456")
      expect(gate.user.institutionId).toBe("bsuir")
    }
  })

  it("returns 403 when the role is not allowed", async () => {
    getUserByUsername.mockResolvedValue({
      username: "7123456",
      role: "student",
      additionalRoles: [],
    })
    const gate = await requireSessionApi(
      getRequest("http://antiplagiat.bsuir.by/api/admin/users", sessionCookie("7123456", "student")),
      ["admin", "superadmin"],
    )
    expect(gate.ok).toBe(false)
    if (!gate.ok) {
      expect(gate.response.status).toBe(403)
      const body = await gate.response.json()
      expect(body.error).toBe("Недостаточно прав")
    }
  })

  it("returns 401 when idle timeout has elapsed", async () => {
    vi.stubEnv("SESSION_IDLE_TIMEOUT_SEC", "60")
    getUserByUsername.mockResolvedValue({
      username: "7123456",
      role: "student",
      additionalRoles: [],
    })
    const token = signGuardSessionCookie("7123456", "student", undefined, 3600, Date.now() - 120_000)
    const gate = await requireSessionApi(
      getRequest("http://antiplagiat.bsuir.by/api/auth/me", cookieHeader(token)),
    )
    expect(gate.ok).toBe(false)
    if (!gate.ok) {
      expect(gate.response.status).toBe(401)
    }
  })

  it("accepts a legacy cookie without act and a fresh idle session", async () => {
    getUserByUsername.mockResolvedValue({
      username: "7123456",
      role: "student",
      additionalRoles: [],
    })
    const gate = await requireSessionApi(
      getRequest("http://antiplagiat.bsuir.by/api/auth/me", legacyCookieWithoutAct("7123456", "student")),
    )
    expect(gate.ok).toBe(true)
  })

  it("skips idle check when SESSION_IDLE_TIMEOUT_SEC is 0", async () => {
    vi.stubEnv("SESSION_IDLE_TIMEOUT_SEC", "0")
    getUserByUsername.mockResolvedValue({
      username: "7123456",
      role: "student",
      additionalRoles: [],
    })
    const token = signGuardSessionCookie("7123456", "student", undefined, 3600, Date.now() - 9 * 60 * 60 * 1000)
    const gate = await requireSessionApi(
      getRequest("http://antiplagiat.bsuir.by/api/auth/me", cookieHeader(token)),
    )
    expect(gate.ok).toBe(true)
  })
})
