import { beforeEach, describe, expect, it, vi } from "vitest"
import { getRequest, jsonRequest, sessionCookie } from "../helpers"
import { GUARD_SESSION_COOKIE } from "@/lib/guard-session.constants"

const getUserByUsername = vi.fn()

vi.mock("@/lib/user-storage", () => ({
  getUserByUsername: (...args: unknown[]) => getUserByUsername(...args),
}))

import { POST as logout } from "@/app/api/auth/logout/route"
import { GET as me } from "@/app/api/auth/me/route"

describe("POST /api/auth/logout", () => {
  it("clears the session cookie", async () => {
    const res = await logout(jsonRequest("http://antiplagiat.bsuir.by/api/auth/logout", {}))
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
    const cookie = res.cookies.get(GUARD_SESSION_COOKIE)
    expect(cookie?.value).toBe("")
  })
})

describe("GET /api/auth/me", () => {
  beforeEach(() => {
    getUserByUsername.mockReset()
  })

  it("returns 401 without a session", async () => {
    const res = await me(getRequest("http://antiplagiat.bsuir.by/api/auth/me"))
    expect(res.status).toBe(401)
  })

  it("returns the profile flags for a signed-in BSUIR student", async () => {
    getUserByUsername.mockResolvedValue({
      username: "7123456",
      role: "student",
      additionalRoles: [],
      fullName: "Иванов Иван",
      email: "i@bsuir.by",
      institution: "БГУИР",
      institutionId: "bsuir",
      faculty: "ФКСиС",
      group: "050501",
    })
    const res = await me(
      getRequest("http://antiplagiat.bsuir.by/api/auth/me", sessionCookie("7123456", "student")),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.user.username).toBe("7123456")
    expect(body.user.isBsuirUser).toBe(true)
    expect(body.user.needsProfileCompletion).toBe(false)
  })

  it("returns 404 if the user row disappeared", async () => {
    getUserByUsername.mockResolvedValue(null)
    const res = await me(getRequest("http://antiplagiat.bsuir.by/api/auth/me", sessionCookie("gone", "student")))
    expect(res.status).toBe(404)
  })
})
