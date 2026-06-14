/**
 * Справочники учебных заведений и факультетов — хранятся в PostgreSQL.
 * При первом обращении таблица seeds дефолтным БГУИР если она пустая.
 */

import { prisma } from "./prisma"

export interface FacultyEntry {
  id: string
  name: string
}

export interface InstitutionEntry {
  id: string
  name: string
  faculties: FacultyEntry[]
}

// ── Seed ─────────────────────────────────────────────────────────────────────

const DEFAULT_INSTITUTIONS: Array<{ id: string; name: string; faculties: Array<{ id: string; name: string }> }> = [
  {
    id: "bsuir",
    name: "БГУИР",
    faculties: [
      { id: "fitu",  name: "Факультет информационных технологий и управления" },
      { id: "fksis", name: "Факультет компьютерных систем и сетей" },
      { id: "fkaf",  name: "Факультет компьютерного проектирования" },
    ],
  },
]

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

// ── Readers ──────────────────────────────────────────────────────────────────

export async function getDirectories(): Promise<InstitutionEntry[]> {
  await ensureSeeded()
  const rows = await prisma.institution.findMany({
    include: { faculties: { orderBy: { name: "asc" } } },
    orderBy: { name: "asc" },
  })
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    faculties: r.faculties.map((f) => ({ id: f.id, name: f.name })),
  }))
}

export async function getInstitutionById(id: string): Promise<InstitutionEntry | null> {
  const row = await prisma.institution.findUnique({
    where: { id },
    include: { faculties: true },
  })
  if (!row) return null
  return { id: row.id, name: row.name, faculties: row.faculties.map((f) => ({ id: f.id, name: f.name })) }
}

/** Resolve institution display name → DB id. Returns null if not found. */
export async function resolveInstitutionId(nameOrId: string | undefined | null): Promise<string | null> {
  if (!nameOrId) return null
  await ensureSeeded()
  const byId = await prisma.institution.findUnique({ where: { id: nameOrId } })
  if (byId) return byId.id
  const byName = await prisma.institution.findFirst({ where: { name: nameOrId } })
  if (byName) return byName.id
  // Auto-create so existing code that passes a display name keeps working
  const id = nameOrId.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9а-яё_-]/gi, "").slice(0, 50) || "unknown"
  const created = await prisma.institution.upsert({
    where: { id },
    update: {},
    create: { id, name: nameOrId },
  })
  return created.id
}

/** Resolve faculty display name → DB id within an institution. Returns null if not found. */
export async function resolveFacultyId(institutionId: string, nameOrId: string | undefined | null): Promise<string | null> {
  if (!nameOrId || !institutionId) return null
  const byId = await prisma.faculty.findFirst({ where: { id: nameOrId, institutionId } })
  if (byId) return byId.id
  const byName = await prisma.faculty.findFirst({ where: { name: nameOrId, institutionId } })
  if (byName) return byName.id
  // Auto-create
  const id = nameOrId.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9а-яё_-]/gi, "").slice(0, 50) || "unknown"
  const existing = await prisma.faculty.findUnique({ where: { id } })
  if (existing) return existing.id
  const created = await prisma.faculty.create({ data: { id, name: nameOrId, institutionId } })
  return created.id
}

// ── Institution CRUD ──────────────────────────────────────────────────────────

export async function addInstitution(
  name: string,
): Promise<{ success: boolean; error?: string; institution?: InstitutionEntry }> {
  const label = name.trim()
  if (!label) return { success: false, error: "Название обязательно" }
  const id = label.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9а-яё_-]/gi, "").slice(0, 50)
  const existing = await prisma.institution.findUnique({ where: { id } })
  if (existing) return { success: false, error: "УО уже существует" }
  const inst = await prisma.institution.create({ data: { id, name: label } })
  return { success: true, institution: { id: inst.id, name: inst.name, faculties: [] } }
}

export async function updateInstitution(id: string, name: string): Promise<{ success: boolean; error?: string }> {
  if (!name.trim()) return { success: false, error: "Название обязательно" }
  const existing = await prisma.institution.findUnique({ where: { id } })
  if (!existing) return { success: false, error: "УО не найдено" }
  await prisma.institution.update({ where: { id }, data: { name: name.trim() } })
  return { success: true }
}

export async function deleteInstitution(id: string): Promise<{ success: boolean; error?: string }> {
  const existing = await prisma.institution.findUnique({ where: { id } })
  if (!existing) return { success: false, error: "УО не найдено" }
  await prisma.institution.delete({ where: { id } })
  return { success: true }
}

// ── Faculty CRUD ─────────────────────────────────────────────────────────────

export async function addFaculty(
  institutionId: string,
  name: string,
): Promise<{ success: boolean; error?: string; faculty?: FacultyEntry }> {
  const inst = await prisma.institution.findUnique({ where: { id: institutionId } })
  if (!inst) return { success: false, error: "УО не найдено" }
  const label = name.trim()
  if (!label) return { success: false, error: "Название обязательно" }
  const id = label.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9а-яё_-]/gi, "").slice(0, 50)
  const existing = await prisma.faculty.findUnique({ where: { id } })
  if (existing) return { success: false, error: "Факультет уже существует" }
  const fac = await prisma.faculty.create({ data: { id, name: label, institutionId } })
  return { success: true, faculty: { id: fac.id, name: fac.name } }
}

export async function updateFaculty(
  institutionId: string,
  facultyId: string,
  name: string,
): Promise<{ success: boolean; error?: string }> {
  if (!name.trim()) return { success: false, error: "Название обязательно" }
  const fac = await prisma.faculty.findFirst({ where: { id: facultyId, institutionId } })
  if (!fac) return { success: false, error: "Факультет не найден" }
  await prisma.faculty.update({ where: { id: facultyId }, data: { name: name.trim() } })
  return { success: true }
}

export async function deleteFaculty(
  institutionId: string,
  facultyId: string,
): Promise<{ success: boolean; error?: string }> {
  const fac = await prisma.faculty.findFirst({ where: { id: facultyId, institutionId } })
  if (!fac) return { success: false, error: "Факультет не найден" }
  await prisma.faculty.delete({ where: { id: facultyId } })
  return { success: true }
}
