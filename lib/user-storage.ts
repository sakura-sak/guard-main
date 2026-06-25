/**
 * Хранилище пользователей — PostgreSQL (Prisma).
 * institution / faculty хранятся как FK на таблицы institutions / faculties.
 * Для обратной совместимости StoredUser по-прежнему выставляет строковые поля
 * institution / faculty (display names), а FK-поля resolveются автоматически.
 */

import type { User, UserRole } from "./auth"
import { prisma } from "./prisma"
import { ensureSqliteSeededFromLocalJson } from "./sqlite-seed"
import { resolveInstitutionId, resolveFacultyId } from "./directories"

export interface StoredUser {
  username: string
  password: string
  role: UserRole
  additionalRoles?: UserRole[]
  email?: string
  fullName?: string
  /** Display name of the institution (e.g. "БГУИР") */
  institution?: string
  /** Institution FK slug (e.g. "bsuir") */
  institutionId?: string
  /** Display name of the faculty */
  faculty?: string
  group?: string
  createdAt: string
  lastLogin?: string
}

export interface UserDatabase {
  users: StoredUser[]
}

async function initDb() {
  await ensureSqliteSeededFromLocalJson()
  return prisma
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Map a DB row (with optional includes) to StoredUser */
function mapRowToStoredUser(row: {
  username: string
  password: string
  role: string
  additionalRolesJson: string | null
  email: string | null
  fullName: string | null
  groupName: string | null
  createdAt: Date
  lastLogin: Date | null
  institution?: { name: string } | null
  faculty?: { name: string } | null
  institutionId?: string | null
}): StoredUser {
  return {
    username: row.username,
    password: row.password,
    role: row.role as UserRole,
    additionalRoles: row.additionalRolesJson ? JSON.parse(row.additionalRolesJson) : [],
    email: row.email ?? undefined,
    fullName: row.fullName ?? undefined,
    institution: row.institution?.name ?? undefined,
    institutionId: row.institutionId ?? undefined,
    faculty: row.faculty?.name ?? undefined,
    group: row.groupName ?? undefined,
    createdAt: row.createdAt.toISOString(),
    lastLogin: row.lastLogin?.toISOString() ?? undefined,
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function readUsersDatabase(): Promise<UserDatabase> {
  const users = await getAllUsers()
  return { users }
}

export async function writeUsersDatabase(db: UserDatabase) {
  const client = await initDb()
  await client.$transaction(
    db.users.map((u) =>
      client.user.upsert({
        where: { username: u.username },
        update: {
          password: u.password,
          role: u.role,
          additionalRolesJson: u.additionalRoles ? JSON.stringify(u.additionalRoles) : null,
          email: u.email ?? null,
          fullName: u.fullName ?? null,
          groupName: u.group ?? null,
          createdAt: new Date(u.createdAt ?? new Date().toISOString()),
          lastLogin: u.lastLogin ? new Date(u.lastLogin) : null,
        },
        create: {
          username: u.username,
          password: u.password,
          role: u.role,
          additionalRolesJson: u.additionalRoles ? JSON.stringify(u.additionalRoles) : null,
          email: u.email ?? null,
          fullName: u.fullName ?? null,
          groupName: u.group ?? null,
          createdAt: new Date(u.createdAt ?? new Date().toISOString()),
          lastLogin: null,
        },
      }),
    ),
  )
}

export async function registerUser(
  username: string,
  password: string,
  role: UserRole = "student",
  email?: string,
  fullName?: string,
  institution?: string,
  faculty?: string,
  group?: string,
): Promise<{ success: boolean; error?: string; user?: User }> {
  const client = await initDb()
  const normalizedUsername = username.trim()

  const existing = await client.user.findUnique({ where: { username: normalizedUsername } })
  if (existing) return { success: false, error: "Пользователь с таким логином уже существует" }
  if (normalizedUsername.length < 3) return { success: false, error: "Логин должен содержать минимум 3 символа" }
  if (password.length < 6) return { success: false, error: "Пароль должен содержать минимум 6 символов" }

  const defaultInstitution = institution || "БГУИР"
  const institutionId = await resolveInstitutionId(defaultInstitution)
  const facultyId = institutionId ? await resolveFacultyId(institutionId, faculty) : null

  await client.user.create({
    data: {
      username: normalizedUsername,
      password,
      role,
      additionalRolesJson: null,
      email: email ?? null,
      fullName: fullName ?? null,
      institutionId,
      facultyId,
      groupName: group ?? null,
      createdAt: new Date(),
      lastLogin: null,
    },
  })

  return {
    success: true,
    user: {
      username: normalizedUsername,
      role,
      email,
      fullName,
      institution: defaultInstitution,
      faculty,
      group,
    },
  }
}

export async function getUserByUsername(username: string): Promise<StoredUser | null> {
  const client = await initDb()
  const row = await client.user.findUnique({
    where: { username: username.trim() },
    include: { institution: true, faculty: true },
  })
  return row ? mapRowToStoredUser(row) : null
}

export async function updateLastLogin(username: string) {
  const client = await initDb()
  await client.user.update({ where: { username: username.trim() }, data: { lastLogin: new Date() } })
}

export async function getAllUsers(): Promise<StoredUser[]> {
  const client = await initDb()
  const rows = await client.user.findMany({
    include: { institution: true, faculty: true },
    orderBy: { createdAt: "desc" },
  })
  return rows.map(mapRowToStoredUser)
}

export async function deleteUser(username: string): Promise<boolean> {
  const client = await initDb()
  const info = await client.user.deleteMany({ where: { username: username.trim() } })
  return info.count > 0
}

export async function updateUserRole(username: string, role: UserRole): Promise<boolean> {
  const client = await initDb()
  const info = await client.user.updateMany({ where: { username: username.trim() }, data: { role } })
  return info.count > 0
}

export async function updateUserAdditionalRoles(username: string, additionalRoles: UserRole[]): Promise<boolean> {
  const client = await initDb()
  const roles = additionalRoles?.filter(Boolean) ?? []
  const info = await client.user.updateMany({
    where: { username: username.trim() },
    data: { additionalRolesJson: JSON.stringify(roles) },
  })
  return info.count > 0
}

export async function updateUserProfile(
  username: string,
  data: { fullName?: string; institution?: string; faculty?: string; group?: string; email?: string },
): Promise<boolean> {
  const client = await initDb()

  const patch: Record<string, unknown> = {}
  if (data.fullName !== undefined) patch.fullName = data.fullName || null
  if (data.group !== undefined) patch.groupName = data.group || null
  if (data.email !== undefined) patch.email = data.email || null

  if (data.institution !== undefined) {
    patch.institutionId = await resolveInstitutionId(data.institution || "БГУИР")
  }
  if (data.faculty !== undefined) {
    const instId = patch.institutionId as string | undefined
      ?? (await client.user.findUnique({ where: { username: username.trim() } }))?.institutionId
      ?? null
    patch.facultyId = instId ? await resolveFacultyId(instId, data.faculty) : null
  }

  const info = await client.user.updateMany({ where: { username: username.trim() }, data: patch })
  return info.count > 0
}

export async function updateUserByAdmin(
  username: string,
  data: {
    password?: string
    role?: UserRole
    additionalRoles?: UserRole[]
    email?: string
    fullName?: string
    institution?: string
    faculty?: string
    group?: string
  },
): Promise<boolean> {
  const client = await initDb()
  const patch: Record<string, unknown> = {}
  if (data.password) patch.password = data.password
  if (data.role) patch.role = data.role
  if (data.additionalRoles !== undefined) patch.additionalRolesJson = JSON.stringify(data.additionalRoles)
  if (data.email !== undefined) patch.email = data.email || null
  if (data.fullName !== undefined) patch.fullName = data.fullName || null
  if (data.group !== undefined) patch.groupName = data.group || null

  if (data.institution !== undefined) {
    patch.institutionId = await resolveInstitutionId(data.institution || "БГУИР")
  }
  if (data.faculty !== undefined) {
    const instId = patch.institutionId as string | undefined
      ?? (await client.user.findUnique({ where: { username: username.trim() } }))?.institutionId
      ?? null
    patch.facultyId = instId ? await resolveFacultyId(instId, data.faculty) : null
  }

  const info = await client.user.updateMany({ where: { username: username.trim() }, data: patch })
  return info.count > 0
}

export function filterUsersBySearch(users: StoredUser[], search: string): StoredUser[] {
  const q = search.trim().toLowerCase()
  if (!q) return users
  return users.filter(
    (u) =>
      (u.fullName && u.fullName.toLowerCase().includes(q)) ||
      u.username.toLowerCase().includes(q) ||
      (u.faculty && u.faculty.toLowerCase().includes(q)) ||
      (u.group && u.group.toLowerCase().includes(q)),
  )
}
