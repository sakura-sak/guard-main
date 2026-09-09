import { beforeEach, describe, expect, it, vi } from "vitest"
import { jsonRequest } from "../helpers"
import { GUARD_SESSION_COOKIE } from "@/lib/guard-session.constants"

const authenticateLDAP = vi.fn()
const mapLDAPUserToUser = vi.fn()
const getLDAPConfig = vi.fn()
const getUserByUsername = vi.fn()
const updateLastLogin = vi.fn()
const registerUser = vi.fn()
const updateUserProfile = vi.fn()

vi.mock("@/lib/ldap", () => ({
  authenticateLDAP: (...args: unknown[]) => authenticateLDAP(...args),
  mapLDAPUserToUser: (...args: unknown[]) => mapLDAPUserToUser(...args),
  getLDAPConfig: (...args: unknown[]) => getLDAPConfig(...args),
}))

vi.mock("@/lib/user-storage", () => ({
  getUserByUsername: (...args: unknown[]) => getUserByUsername(...args),
  updateLastLogin: (...args: unknown[]) => updateLastLogin(...args),
  registerUser: (...args: unknown[]) => registerUser(...args),
  updateUserProfile: (...args: unknown[]) => updateUserProfile(...args),
}))

vi.mock("@/lib/logger", () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
}))

import { POST } from "@/app/api/auth/login/route"

describe("POST /api/auth/login", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getLDAPConfig.mockReturnValue(null)
  })

  it("rejects empty credentials", async () => {
    const res = await POST(jsonRequest("http://antiplagiat.bsuir.by/api/auth/login", { username: " ", password: "" }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe("Логин и пароль обязательны")
  })

  it("creates a session after successful LDAP bind", async () => {
    getLDAPConfig.mockReturnValue({ enabled: true })
    authenticateLDAP.mockResolvedValue({
      success: true,
      user: { username: "7123456", fullName: "Иванов Иван", email: "i@bsuir.by", dn: "uid=7123456,ou=stud,dc=bsuir,dc=by" },
    })
    mapLDAPUserToUser.mockReturnValue({
      username: "7123456",
      role: "student",
      fullName: "Иванов Иван",
      email: "i@bsuir.by",
      institution: "БГУИР",
    })
    getUserByUsername.mockResolvedValue(null)
    registerUser.mockResolvedValue({ success: true })

    const res = await POST(
      jsonRequest("http://antiplagiat.bsuir.by/api/auth/login", { username: "7123456", password: "secret" }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.user.username).toBe("7123456")
    expect(body.user.role).toBe("student")
    expect(registerUser).toHaveBeenCalledWith(
      "7123456",
      "LDAP_AUTH_ONLY_USER_MARKER",
      "student",
      "i@bsuir.by",
      "Иванов Иван",
      "БГУИР",
    )
    const setCookie = res.cookies.get(GUARD_SESSION_COOKIE)
    expect(setCookie?.value).toBeTruthy()
  })

  it("keeps the role already stored in PostgreSQL", async () => {
    getLDAPConfig.mockReturnValue({ enabled: true })
    authenticateLDAP.mockResolvedValue({
      success: true,
      user: { username: "smirnov", dn: "uid=smirnov,ou=staff,dc=bsuir,dc=by" },
    })
    mapLDAPUserToUser.mockReturnValue({
      username: "smirnov",
      role: "teacher",
      institution: "БГУИР",
    })
    getUserByUsername.mockResolvedValue({
      username: "smirnov",
      role: "admin",
      fullName: "Смирнов",
      email: "s@bsuir.by",
      institution: "БГУИР",
    })

    const res = await POST(
      jsonRequest("http://antiplagiat.bsuir.by/api/auth/login", { username: "smirnov", password: "secret" }),
    )
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.user.role).toBe("admin")
    expect(registerUser).not.toHaveBeenCalled()
    expect(updateLastLogin).toHaveBeenCalledWith("smirnov")
  })

  it("falls back to a local password when LDAP is off", async () => {
    getUserByUsername.mockResolvedValue({
      username: "demo",
      password: "demo",
      role: "student",
      additionalRoles: [],
    })
    const res = await POST(
      jsonRequest("http://antiplagiat.bsuir.by/api/auth/login", { username: "demo", password: "demo" }),
    )
    expect(res.status).toBe(200)
    expect((await res.json()).user.username).toBe("demo")
  })

  it("returns 401 for a wrong password", async () => {
    getUserByUsername.mockResolvedValue({
      username: "demo",
      password: "demo",
      role: "student",
    })
    const res = await POST(
      jsonRequest("http://antiplagiat.bsuir.by/api/auth/login", { username: "demo", password: "wrong" }),
    )
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe("Неверный логин или пароль")
  })
})
