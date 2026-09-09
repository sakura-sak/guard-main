import { beforeEach, describe, expect, it, vi } from "vitest"
import { getRequest, sessionCookie } from "../helpers"

const getUserByUsername = vi.fn()
vi.mock("@/lib/user-storage", () => ({
  getUserByUsername: (...args: unknown[]) => getUserByUsername(...args),
}))

import { assertInstitutionAccess, assertUserInScope, requireAdminApi, requireSuperAdminApi } from "@/lib/require-admin-api"

describe("requireAdminApi", () => {
  beforeEach(() => getUserByUsername.mockReset())

  it("rejects missing session and non-admin", async () => {
    const noCookie = await requireAdminApi(getRequest("http://x/api/admin"))
    expect(noCookie.ok).toBe(false)

    getUserByUsername.mockResolvedValue({ username: "s", role: "student", institutionId: "bsuir" })
    const student = await requireAdminApi(getRequest("http://x/api/admin", sessionCookie("s", "student")))
    expect(student.ok).toBe(false)
  })

  it("requires institutionId for university admin", async () => {
    getUserByUsername.mockResolvedValue({ username: "a", role: "admin" })
    const res = await requireAdminApi(getRequest("http://x/api/admin", sessionCookie("a", "admin")))
    expect(res.ok).toBe(false)
  })

  it("allows admin of an institution and superadmin", async () => {
    getUserByUsername.mockResolvedValue({ username: "a", role: "admin", institutionId: "bsuir", institution: "БГУИР" })
    const admin = await requireAdminApi(getRequest("http://x/api/admin", sessionCookie("a", "admin")))
    expect(admin.ok).toBe(true)
    if (admin.ok) {
      expect(assertInstitutionAccess(admin, "bsuir")).toBeNull()
      expect(assertInstitutionAccess(admin, "bgu")?.status).toBe(403)
      expect(assertUserInScope(admin, { institutionId: "bsuir", role: "student" })).toBeNull()
      expect(assertUserInScope(admin, { institutionId: "bsuir", role: "superadmin" })?.status).toBe(403)
    }

    getUserByUsername.mockResolvedValue({ username: "root", role: "superadmin" })
    const superadmin = await requireSuperAdminApi(getRequest("http://x/api/admin", sessionCookie("root", "superadmin")))
    expect(superadmin.ok).toBe(true)
  })
})
