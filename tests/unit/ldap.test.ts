import { afterEach, describe, expect, it, vi } from "vitest"

describe("LDAP helpers", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it("returns null config when LDAP is disabled", async () => {
    vi.stubEnv("LDAP_ENABLED", "false")
    const { getLDAPConfig } = await import("@/lib/ldap")
    expect(getLDAPConfig()).toBeNull()
  })

  it("reads BSUIR search bases and maps numeric uid to student", async () => {
    vi.stubEnv("LDAP_ENABLED", "true")
    vi.stubEnv("LDAP_URL", "ldaps://ldap.bsuir.by")
    vi.stubEnv("LDAP_BASE_DN", "dc=bsuir,dc=by")
    vi.stubEnv("LDAP_USER_SEARCH_BASES", "ou=staff,dc=bsuir,dc=by;ou=stud,dc=bsuir,dc=by")
    const { getLDAPConfig, mapLDAPUserToUser } = await import("@/lib/ldap")
    const cfg = getLDAPConfig()
    expect(cfg?.enabled).toBe(true)
    expect(cfg?.userSearchBases).toHaveLength(2)
    expect(mapLDAPUserToUser({ username: "7123456", dn: "uid=7123456" }).role).toBe("student")
    expect(mapLDAPUserToUser({ username: "ivanov", dn: "uid=ivanov" }).role).toBe("teacher")
    expect(mapLDAPUserToUser({ username: "ivanov", dn: "x" }).institution).toBe("БГУИР")
  })

  it("fails authenticateLDAP when LDAP is not configured", async () => {
    vi.stubEnv("LDAP_ENABLED", "false")
    const { authenticateLDAP } = await import("@/lib/ldap")
    const result = await authenticateLDAP("u", "p")
    expect(result.success).toBe(false)
  })
})
