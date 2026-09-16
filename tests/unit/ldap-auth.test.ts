import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const ldapMocks = vi.hoisted(() => ({
  bind: vi.fn(),
  search: vi.fn(),
  unbind: vi.fn(),
}))

const loggerMocks = vi.hoisted(() => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
  logWarning: vi.fn(),
}))

vi.mock("ldapts", () => ({
  Client: class {
    bind = ldapMocks.bind
    search = ldapMocks.search
    unbind = ldapMocks.unbind
  },
}))

vi.mock("@/lib/logger", () => loggerMocks)

import { authenticateLDAP, getUserInfoLDAP } from "@/lib/ldap"

describe("LDAP bind and search", () => {
  beforeEach(() => {
    vi.stubEnv("LDAP_ENABLED", "true")
    vi.stubEnv("LDAP_URL", "ldaps://ldap.bsuir.by")
    vi.stubEnv("LDAP_BASE_DN", "dc=bsuir,dc=by")
    vi.stubEnv("LDAP_BIND_DN", "cn=reader,dc=bsuir,dc=by")
    vi.stubEnv("LDAP_BIND_PASSWORD", "secret")
    vi.stubEnv("LDAP_USER_SEARCH_BASES", "ou=stud,dc=bsuir,dc=by")
    ldapMocks.bind.mockReset().mockResolvedValue(undefined)
    ldapMocks.unbind.mockReset().mockResolvedValue(undefined)
    ldapMocks.search.mockReset().mockResolvedValue({
      searchEntries: [
        {
          dn: "uid=7123456,ou=stud,dc=bsuir,dc=by",
          uid: "7123456",
          mail: "s@bsuir.by",
          givenName: "Иван",
          sn: "Иванов",
          middleName: "Иванович",
        },
      ],
    })
    loggerMocks.logInfo.mockReset()
    loggerMocks.logError.mockReset()
    loggerMocks.logWarning.mockReset()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("authenticates with service bind then user bind", async () => {
    const result = await authenticateLDAP("7123456", "pass")
    expect(result.success).toBe(true)
    expect(result.user?.username).toBe("7123456")
    expect(result.user?.fullName).toContain("Иванов")
    expect(ldapMocks.bind).toHaveBeenCalled()
  })

  it("rejects unknown users and bad passwords", async () => {
    ldapMocks.search.mockResolvedValueOnce({ searchEntries: [] })
    expect((await authenticateLDAP("nobody", "x")).success).toBe(false)
    expect(loggerMocks.logInfo).toHaveBeenCalledWith(
      "Пользователь не найден в LDAP, проверяем локальную базу",
      "nobody",
      undefined,
      "ldap",
    )
    expect(loggerMocks.logError).not.toHaveBeenCalled()

    ldapMocks.search.mockResolvedValueOnce({
      searchEntries: [{ dn: "uid=x,ou=stud,dc=bsuir,dc=by", uid: "x" }],
    })
    ldapMocks.bind
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("invalid creds"))
    expect((await authenticateLDAP("x", "wrong")).success).toBe(false)
    expect(loggerMocks.logInfo).toHaveBeenCalledWith(
      "LDAP неверный пароль, проверяем локальную базу",
      "x",
      undefined,
      "ldap",
    )
  })

  it("loads user info without password check", async () => {
    const info = await getUserInfoLDAP("7123456")
    expect(info?.email).toBe("s@bsuir.by")
    expect(info?.fullName).toContain("Иван")
  })

  it("returns null user info when LDAP is disabled", async () => {
    vi.stubEnv("LDAP_ENABLED", "false")
    expect(await getUserInfoLDAP("7123456")).toBeNull()
  })
})
