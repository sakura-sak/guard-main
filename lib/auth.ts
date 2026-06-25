export type UserRole = "student" | "teacher" | "admin" | "superadmin"

export interface User {
  username: string
  role: UserRole
  /** Дополнительные роли, выданные админом */
  additionalRoles?: UserRole[]
  email?: string
  fullName?: string
  middleName?: string
  institution?: string
}

/** Проверка, что у пользователя есть роль (основная или дополнительная) */
export function hasRole(user: User | null, role: UserRole): boolean {
  if (!user) return false
  if (user.role === role) return true
  return Boolean(user.additionalRoles?.includes(role))
}

export function saveSession(user: User): void {
  if (typeof window !== "undefined") {
    localStorage.setItem("user", JSON.stringify(user))
  }
}

export function getSession(): User | null {
  if (typeof window !== "undefined") {
    const data = localStorage.getItem("user")
    if (data) {
      return JSON.parse(data)
    }
  }
  return null
}

export function clearSession(): void {
  if (typeof window !== "undefined") {
    localStorage.removeItem("user")
    void fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => {})
  }
}
