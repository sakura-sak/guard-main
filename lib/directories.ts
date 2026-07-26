/**
 * Справочники учебных заведений и факультетов — PostgreSQL.
 * Superadmin: УО и глобальные типы; uni-admin: факультеты своего УО.
 * «Удаление» = деактивация (isActive=false) с проверкой использования.
 */

import { prisma } from "./prisma"
import { writeAuditLog } from "./audit-log"

export interface FacultyEntry {
  id: string
  name: string
  isActive: boolean
}

export interface InstitutionEntry {
  id: string
  name: string
  isActive: boolean
  faculties: FacultyEntry[]
}

const DEFAULT_INSTITUTIONS: Array<{ id: string; name: string; faculties: Array<{ id: string; name: string }> }> = [
  {
    id: "bsuir",
    name: "БГУИР",
    faculties: [
      { id: "fitu", name: "Факультет информационных технологий и управления" },
      { id: "fksis", name: "Факультет компьютерных систем и сетей" },
      { id: "fkaf", name: "Факультет компьютерного проектирования" },
    ],
  },
  {
    id: "bsu",
    name: "БГУ",
    faculties: [
      { id: "bsu_mf", name: "Механико-математический факультет" },
      { id: "bsu_ff", name: "Физический факультет" },
    ],
  },
]

function slugFromLabel(label: string): string {
  return label.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9а-яё_-]/gi, "").slice(0, 50) || "unknown"
}

async function ensureSeeded(): Promise<void> {
  const count = await prisma.institution.count()
  if (count > 0) return

  for (const inst of DEFAULT_INSTITUTIONS) {
    await prisma.institution.create({
      data: {
        id: inst.id,
        name: inst.name,
        faculties: {
          create: inst.faculties.map((f) => ({ id: f.id, name: f.name })),
        },
      },
    })
  }
}

function mapFaculty(row: { id: string; name: string; isActive: boolean }): FacultyEntry {
  return { id: row.id, name: row.name, isActive: row.isActive }
}

function mapInstitution(row: {
  id: string
  name: string
  isActive: boolean
  faculties: Array<{ id: string; name: string; isActive: boolean }>
}): InstitutionEntry {
  return {
    id: row.id,
    name: row.name,
    isActive: row.isActive,
    faculties: row.faculties.map(mapFaculty),
  }
}

async function institutionUsage(id: string): Promise<{ users: number; documents: number }> {
  const [users, documents] = await Promise.all([
    prisma.user.count({ where: { institutionId: id } }),
    prisma.document.count({ where: { institutionId: id } }),
  ])
  return { users, documents }
}

async function facultyUsage(id: string): Promise<{ users: number; documents: number }> {
  const [users, documents] = await Promise.all([
    prisma.user.count({ where: { facultyId: id } }),
    prisma.document.count({ where: { facultyId: id } }),
  ])
  return { users, documents }
}

function usageError(label: string, usage: { users: number; documents: number }): string {
  const parts: string[] = []
  if (usage.users > 0) parts.push(`${usage.users} пользоват.`)
  if (usage.documents > 0) parts.push(`${usage.documents} докум.`)
  return `Нельзя деактивировать «${label}»: используется (${parts.join(", ")})`
}

// ── Readers ──────────────────────────────────────────────────────────────────

export async function getDirectories(opts?: { activeOnly?: boolean }): Promise<InstitutionEntry[]> {
  await ensureSeeded()
  const activeOnly = opts?.activeOnly ?? false

  const rows = await prisma.institution.findMany({
    where: activeOnly ? { isActive: true } : undefined,
    include: {
      faculties: {
        where: activeOnly ? { isActive: true } : undefined,
        orderBy: { name: "asc" },
      },
    },
    orderBy: { name: "asc" },
  })

  return rows.map(mapInstitution)
}

export async function getInstitutionById(id: string): Promise<InstitutionEntry | null> {
  const row = await prisma.institution.findUnique({
    where: { id },
    include: { faculties: { orderBy: { name: "asc" } } },
  })
  return row ? mapInstitution(row) : null
}

/** Resolve institution display name or id → DB id (active only). */
export async function resolveInstitutionId(nameOrId: string | undefined | null): Promise<string | null> {
  if (!nameOrId) return null
  await ensureSeeded()
  const byId = await prisma.institution.findFirst({ where: { id: nameOrId, isActive: true } })
  if (byId) return byId.id
  const byName = await prisma.institution.findFirst({ where: { name: nameOrId, isActive: true } })
  return byName?.id ?? null
}

/** Resolve faculty display name or id → DB id within an institution (active only). */
export async function resolveFacultyId(
  institutionId: string,
  nameOrId: string | undefined | null,
): Promise<string | null> {
  if (!nameOrId || !institutionId) return null
  const raw = nameOrId.trim()
  if (!raw) return null

  const byId = await prisma.faculty.findFirst({
    where: { id: raw, institutionId, isActive: true },
  })
  if (byId) return byId.id

  const byName = await prisma.faculty.findFirst({
    where: { name: raw, institutionId, isActive: true },
  })
  if (byName) return byName.id

  const byNameCi = await prisma.faculty.findFirst({
    where: { institutionId, isActive: true, name: { equals: raw, mode: "insensitive" } },
  })
  return byNameCi?.id ?? null
}

// ── Institution CRUD (superadmin) ───────────────────────────────────────────

export async function addInstitution(
  name: string,
  actorUsername?: string,
): Promise<{ success: boolean; error?: string; institution?: InstitutionEntry }> {
  const label = name.trim()
  if (!label) return { success: false, error: "Название обязательно" }
  const id = slugFromLabel(label)
  const existing = await prisma.institution.findUnique({ where: { id } })
  if (existing) {
    if (!existing.isActive) {
      await prisma.institution.update({ where: { id }, data: { name: label, isActive: true } })
      const inst = await getInstitutionById(id)
      await writeAuditLog({
        userId: actorUsername,
        action: "admin_activate_institution",
        message: `УО активировано: ${label}`,
        entityType: "institution",
        entityId: id,
      })
      return { success: true, institution: inst ?? undefined }
    }
    return { success: false, error: "УО уже существует" }
  }
  const inst = await prisma.institution.create({ data: { id, name: label } })
  await writeAuditLog({
    userId: actorUsername,
    action: "admin_add_institution",
    message: `УО добавлено: ${label}`,
    entityType: "institution",
    entityId: id,
  })
  return { success: true, institution: { id: inst.id, name: inst.name, isActive: true, faculties: [] } }
}

export async function updateInstitution(
  id: string,
  name: string,
  actorUsername?: string,
): Promise<{ success: boolean; error?: string }> {
  if (!name.trim()) return { success: false, error: "Название обязательно" }
  const existing = await prisma.institution.findUnique({ where: { id } })
  if (!existing) return { success: false, error: "УО не найдено" }
  await prisma.institution.update({ where: { id }, data: { name: name.trim() } })
  await writeAuditLog({
    userId: actorUsername,
    action: "admin_update_institution",
    message: `УО переименовано: ${name.trim()}`,
    entityType: "institution",
    entityId: id,
  })
  return { success: true }
}

export async function deactivateInstitution(
  id: string,
  actorUsername?: string,
): Promise<{ success: boolean; error?: string }> {
  const existing = await prisma.institution.findUnique({ where: { id } })
  if (!existing) return { success: false, error: "УО не найдено" }
  if (!existing.isActive) return { success: true }

  const usage = await institutionUsage(id)
  if (usage.users > 0 || usage.documents > 0) {
    return { success: false, error: usageError(existing.name, usage) }
  }

  const faculties = await prisma.faculty.findMany({ where: { institutionId: id, isActive: true } })
  for (const fac of faculties) {
    const facUsage = await facultyUsage(fac.id)
    if (facUsage.users > 0 || facUsage.documents > 0) {
      return { success: false, error: usageError(`факультет «${fac.name}»`, facUsage) }
    }
  }

  await prisma.$transaction([
    prisma.faculty.updateMany({ where: { institutionId: id }, data: { isActive: false } }),
    prisma.institution.update({ where: { id }, data: { isActive: false } }),
  ])

  await writeAuditLog({
    userId: actorUsername,
    action: "admin_deactivate_institution",
    message: `УО деактивировано: ${existing.name}`,
    entityType: "institution",
    entityId: id,
  })
  return { success: true }
}

export async function activateInstitution(
  id: string,
  actorUsername?: string,
): Promise<{ success: boolean; error?: string }> {
  const existing = await prisma.institution.findUnique({ where: { id } })
  if (!existing) return { success: false, error: "УО не найдено" }
  await prisma.institution.update({ where: { id }, data: { isActive: true } })
  await writeAuditLog({
    userId: actorUsername,
    action: "admin_activate_institution",
    message: `УО активировано: ${existing.name}`,
    entityType: "institution",
    entityId: id,
  })
  return { success: true }
}

/** @deprecated Use deactivateInstitution */
export async function deleteInstitution(id: string, actorUsername?: string) {
  return deactivateInstitution(id, actorUsername)
}

// ── Faculty CRUD (superadmin + uni-admin own UO) ────────────────────────────

export async function addFaculty(
  institutionId: string,
  name: string,
  actorUsername?: string,
): Promise<{ success: boolean; error?: string; faculty?: FacultyEntry }> {
  const inst = await prisma.institution.findUnique({ where: { id: institutionId } })
  if (!inst) return { success: false, error: "УО не найдено" }
  if (!inst.isActive) return { success: false, error: "УО деактивировано" }

  const label = name.trim()
  if (!label) return { success: false, error: "Название обязательно" }
  const id = slugFromLabel(label)
  const existing = await prisma.faculty.findUnique({ where: { id } })
  if (existing) {
    if (existing.institutionId !== institutionId) {
      return { success: false, error: "Факультет с таким идентификатором уже существует в другом УО" }
    }
    if (!existing.isActive) {
      await prisma.faculty.update({ where: { id }, data: { name: label, isActive: true } })
      await writeAuditLog({
        userId: actorUsername,
        action: "admin_activate_faculty",
        message: `Факультет активирован: ${label}`,
        entityType: "faculty",
        entityId: id,
      })
      return { success: true, faculty: { id, name: label, isActive: true } }
    }
    return { success: false, error: "Факультет уже существует" }
  }

  const fac = await prisma.faculty.create({ data: { id, name: label, institutionId } })
  await writeAuditLog({
    userId: actorUsername,
    action: "admin_add_faculty",
    message: `Факультет добавлен: ${label} (${inst.name})`,
    entityType: "faculty",
    entityId: fac.id,
  })
  return { success: true, faculty: mapFaculty(fac) }
}

export async function updateFaculty(
  institutionId: string,
  facultyId: string,
  name: string,
  actorUsername?: string,
): Promise<{ success: boolean; error?: string }> {
  if (!name.trim()) return { success: false, error: "Название обязательно" }
  const fac = await prisma.faculty.findFirst({ where: { id: facultyId, institutionId } })
  if (!fac) return { success: false, error: "Факультет не найден" }
  await prisma.faculty.update({ where: { id: facultyId }, data: { name: name.trim() } })
  await writeAuditLog({
    userId: actorUsername,
    action: "admin_update_faculty",
    message: `Факультет переименован: ${name.trim()}`,
    entityType: "faculty",
    entityId: facultyId,
  })
  return { success: true }
}

export async function deactivateFaculty(
  institutionId: string,
  facultyId: string,
  actorUsername?: string,
): Promise<{ success: boolean; error?: string }> {
  const fac = await prisma.faculty.findFirst({ where: { id: facultyId, institutionId } })
  if (!fac) return { success: false, error: "Факультет не найден" }
  if (!fac.isActive) return { success: true }

  const usage = await facultyUsage(facultyId)
  if (usage.users > 0 || usage.documents > 0) {
    return { success: false, error: usageError(fac.name, usage) }
  }

  await prisma.faculty.update({ where: { id: facultyId }, data: { isActive: false } })
  await writeAuditLog({
    userId: actorUsername,
    action: "admin_deactivate_faculty",
    message: `Факультет деактивирован: ${fac.name}`,
    entityType: "faculty",
    entityId: facultyId,
  })
  return { success: true }
}

export async function activateFaculty(
  institutionId: string,
  facultyId: string,
  actorUsername?: string,
): Promise<{ success: boolean; error?: string }> {
  const inst = await prisma.institution.findUnique({ where: { id: institutionId } })
  if (!inst?.isActive) return { success: false, error: "УО деактивировано — сначала активируйте УО" }
  const fac = await prisma.faculty.findFirst({ where: { id: facultyId, institutionId } })
  if (!fac) return { success: false, error: "Факультет не найден" }
  await prisma.faculty.update({ where: { id: facultyId }, data: { isActive: true } })
  await writeAuditLog({
    userId: actorUsername,
    action: "admin_activate_faculty",
    message: `Факультет активирован: ${fac.name}`,
    entityType: "faculty",
    entityId: facultyId,
  })
  return { success: true }
}

/** @deprecated Use deactivateFaculty */
export async function deleteFaculty(institutionId: string, facultyId: string, actorUsername?: string) {
  return deactivateFaculty(institutionId, facultyId, actorUsername)
}
