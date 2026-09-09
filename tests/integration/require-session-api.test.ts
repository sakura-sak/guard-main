import { beforeEach, describe, expect, it, vi } from "vitest"
import { getRequest, sessionCookie } from "../helpers"

const getUserByUsername = vi.fn()

vi.mock("@/lib/user-storage", () => ({
  getUserByUsername: (...args: unknown[]) => getUserByUsername(...args),
}))

import { requireSessionApi } from "@/lib/require-session-api"

describe("requireSessionApi", () => {
  beforeEach(() => {
    getUserByUsername.mockReset()
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
})
