import { describe, expect, it } from "vitest"
import { buildSessionUserPayload } from "@/lib/session-user-payload"
import type { StoredUser } from "@/lib/user-storage"

function user(overrides: Partial<StoredUser> = {}): StoredUser {
  return {
    username: "7123456",
    password: "LDAP_AUTH_ONLY_USER_MARKER",
    role: "student",
    createdAt: "2026-01-01T00:00:00.000Z",
    institution: "БГУИР",
    institutionId: "bsuir",
    ...overrides,
  }
}

describe("buildSessionUserPayload", () => {
  it("flags incomplete BSUIR profile", () => {
    const payload = buildSessionUserPayload(user({ faculty: "", group: "" }))
    expect(payload.isBsuirUser).toBe(true)
    expect(payload.needsProfileCompletion).toBe(true)
    expect(payload.canSelfCompleteProfile).toBe(true)
    expect(payload.profileBlocked).toBe(false)
  })

  it("blocks a non-BSUIR student with institution already set", () => {
    const payload = buildSessionUserPayload(
      user({
        institution: "БГУ",
        institutionId: "bgu",
        faculty: "",
        group: "",
      }),
    )
    expect(payload.isBsuirUser).toBe(false)
    expect(payload.needsProfileCompletion).toBe(true)
    expect(payload.canSelfCompleteProfile).toBe(false)
    expect(payload.profileBlocked).toBe(true)
  })

  it("does not require profile completion for admins", () => {
    const payload = buildSessionUserPayload(user({ role: "admin", faculty: "", group: "" }))
    expect(payload.needsProfileCompletion).toBe(false)
  })
})
