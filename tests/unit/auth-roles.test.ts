import { describe, expect, it } from "vitest"
import { hasRole, type User } from "@/lib/auth"

describe("hasRole", () => {
  it("returns false for missing user", () => {
    expect(hasRole(null, "admin")).toBe(false)
  })

  it("matches the primary role", () => {
    const user: User = { username: "ivanov", role: "teacher" }
    expect(hasRole(user, "teacher")).toBe(true)
    expect(hasRole(user, "admin")).toBe(false)
  })

  it("matches additional roles granted by admin", () => {
    const user: User = { username: "ivanov", role: "teacher", additionalRoles: ["admin"] }
    expect(hasRole(user, "admin")).toBe(true)
  })
})
