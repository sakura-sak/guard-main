import { beforeEach, describe, expect, it } from "vitest"
import { prismaMock, resetPrismaMock, sampleUserRow } from "../mocks/prisma-mock"
import {
  deleteUser,
  getAllUsers,
  getUserByUsername,
  registerUser,
  updateLastLogin,
  updateUserRole,
  updateUserByAdmin,
  filterUsersBySearch,
} from "@/lib/user-storage"

describe("user-storage", () => {
  beforeEach(() => {
    resetPrismaMock()
    prismaMock.institution.count.mockResolvedValue(1)
    prismaMock.institution.findFirst.mockResolvedValue({ id: "bsuir", name: "БГУИР", isActive: true })
    prismaMock.faculty.findFirst.mockResolvedValue({ id: "fksis", name: "ФКСиС", isActive: true })
  })

  it("maps a user row", async () => {
    prismaMock.user.findUnique.mockResolvedValue(sampleUserRow)
    const user = await getUserByUsername("7123456")
    expect(user?.role).toBe("student")
    expect(user?.institution).toBe("БГУИР")
    expect(user?.group).toBe("050501")
  })

  it("registers a new user and rejects duplicates / short fields", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null)
    const ok = await registerUser("newuser", "secret1", "student", "a@b.c", "Имя", "БГУИР")
    expect(ok.success).toBe(true)

    prismaMock.user.findUnique.mockResolvedValueOnce(sampleUserRow)
    expect((await registerUser("7123456", "secret1")).success).toBe(false)
    expect((await registerUser("ab", "secret1")).success).toBe(false)
    prismaMock.user.findUnique.mockResolvedValueOnce(null)
    expect((await registerUser("abcdef", "123")).success).toBe(false)
  })

  it("lists, updates and deletes users", async () => {
    prismaMock.user.findMany.mockResolvedValue([sampleUserRow])
    expect((await getAllUsers())[0].username).toBe("7123456")
    await updateLastLogin("7123456")
    expect(await updateUserRole("7123456", "teacher")).toBe(true)
    expect(await deleteUser("7123456")).toBe(true)
  })

  it("updates a user from the admin panel and filters search", async () => {
    prismaMock.user.updateMany.mockResolvedValue({ count: 1 })
    expect(
      await updateUserByAdmin("7123456", {
        role: "teacher",
        additionalRoles: ["student"],
        email: "t@bsuir.by",
        fullName: "Иванов",
        institution: "БГУИР",
        faculty: "ФКСиС",
        group: "050501",
      }),
    ).toBe(true)
    const users = [
      {
        username: "7123456",
        password: "x",
        role: "student" as const,
        fullName: "Иванов Иван",
        createdAt: "2026-01-01",
      },
    ]
    expect(filterUsersBySearch(users, "иванов")).toHaveLength(1)
    expect(filterUsersBySearch(users, "zzz")).toHaveLength(0)
    expect(filterUsersBySearch(users, "")).toHaveLength(1)
  })
})
