import { beforeEach, describe, expect, it, vi } from "vitest"
import type { SessionUser } from "@/lib/require-session-api"
import type { StoredUser } from "@/lib/user-storage"

vi.mock("@/lib/directories", () => ({
  resolveInstitutionId: vi.fn(async (value: string) => {
    const key = value.trim().toLowerCase()
    if (key === "bsuir" || key === "бгуир") return "bsuir"
    if (key === "bgu") return "bgu"
    return null
  }),
}))

import { resolveCheckInstitutionScope } from "@/lib/check-institution-scope"

function session(overrides: Partial<SessionUser> = {}): SessionUser {
  return { username: "s1", role: "student", ...overrides }
}

function db(overrides: Partial<StoredUser> = {}): StoredUser {
  return {
    username: "s1",
    password: "x",
    role: "student",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  }
}

describe("resolveCheckInstitutionScope", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("takes institution from student profile", async () => {
    const result = await resolveCheckInstitutionScope(
      session({ institutionId: "bsuir" }),
      db({ institutionId: "bsuir", role: "student" }),
      {},
    )
    expect(result).toEqual({ ok: true, institutionId: "bsuir" })
  })

  it("rejects upload without institution", async () => {
    const result = await resolveCheckInstitutionScope(session(), db(), {})
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(400)
  })

  it("locks university admin to their institution", async () => {
    const ok = await resolveCheckInstitutionScope(
      session({ role: "admin", institutionId: "bsuir" }),
      db({ role: "admin", institutionId: "bsuir" }),
      {},
    )
    expect(ok).toEqual({ ok: true, institutionId: "bsuir" })

    const denied = await resolveCheckInstitutionScope(
      session({ role: "admin", institutionId: "bsuir" }),
      db({ role: "admin", institutionId: "bsuir" }),
      { institutionId: "bgu" },
    )
    expect(denied.ok).toBe(false)
    if (!denied.ok) expect(denied.status).toBe(403)
  })

  it("requires superadmin to choose an institution", async () => {
    const missing = await resolveCheckInstitutionScope(
      session({ role: "superadmin" }),
      db({ role: "superadmin" }),
      {},
    )
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.status).toBe(400)

    const chosen = await resolveCheckInstitutionScope(
      session({ role: "superadmin" }),
      db({ role: "superadmin" }),
      { institutionId: "bsuir" },
    )
    expect(chosen).toEqual({ ok: true, institutionId: "bsuir" })
  })
})
