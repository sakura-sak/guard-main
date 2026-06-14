/**
 * Справочник типов работ (DocumentType) — PostgreSQL (Prisma).
 */

import { prisma } from "./prisma"

export interface DocumentTypeEntry {
  id: number
  name: string
  displayName: string
  description?: string
  isActive: boolean
}

const DEFAULT_TYPES: Array<{ name: string; displayName: string }> = [
  { name: "diploma", displayName: "Дипломная работа / проект" },
  { name: "coursework", displayName: "Курсовая работа / проект" },
  { name: "lab", displayName: "Лабораторная работа" },
  { name: "practice", displayName: "Практическая работа" },
  { name: "article", displayName: "Статьи" },
]

async function ensureSeeded(): Promise<void> {
  const count = await prisma.documentType.count()
  if (count > 0) return
  for (const t of DEFAULT_TYPES) {
    await prisma.documentType.create({ data: t })
  }
}

function mapRow(row: {
  id: number
  name: string
  displayName: string
  description: string | null
  isActive: boolean
}): DocumentTypeEntry {
  return {
    id: row.id,
    name: row.name,
    displayName: row.displayName,
    description: row.description ?? undefined,
    isActive: row.isActive,
  }
}

export function slugifyDocumentTypeName(displayName: string): string {
  const base =
    displayName
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_")
      .replace(/[^a-z0-9_а-яё-]/gi, "")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 64) || "type"
  return base
}

async function uniqueSlug(base: string): Promise<string> {
  let slug = slugifyDocumentTypeName(base)
  let n = 1
  while (await prisma.documentType.findUnique({ where: { name: slug } })) {
    n += 1
    slug = `${slugifyDocumentTypeName(base)}_${n}`
  }
  return slug
}

export async function getAllDocumentTypes(includeInactive = false): Promise<DocumentTypeEntry[]> {
  await ensureSeeded()
  const rows = await prisma.documentType.findMany({
    where: includeInactive ? undefined : { isActive: true },
    orderBy: [{ displayName: "asc" }],
  })
  return rows.map(mapRow)
}

export async function getDocumentTypeById(id: number): Promise<DocumentTypeEntry | null> {
  await ensureSeeded()
  const row = await prisma.documentType.findUnique({ where: { id } })
  return row ? mapRow(row) : null
}

export async function createDocumentType(data: {
  displayName: string
  name?: string
  description?: string
  isActive?: boolean
}): Promise<{ success: boolean; error?: string; type?: DocumentTypeEntry }> {
  await ensureSeeded()
  const displayName = String(data.displayName || "").trim()
  if (!displayName) return { success: false, error: "Название типа обязательно" }

  const name = data.name?.trim()
    ? slugifyDocumentTypeName(data.name)
    : await uniqueSlug(displayName)

  const existing = await prisma.documentType.findUnique({ where: { name } })
  if (existing) return { success: false, error: "Тип с таким идентификатором уже существует" }

  const row = await prisma.documentType.create({
    data: {
      name,
      displayName,
      description: data.description?.trim() || null,
      isActive: data.isActive ?? true,
    },
  })
  return { success: true, type: mapRow(row) }
}

export async function updateDocumentType(
  id: number,
  data: { displayName?: string; name?: string; description?: string; isActive?: boolean },
): Promise<{ success: boolean; error?: string; type?: DocumentTypeEntry }> {
  const existing = await prisma.documentType.findUnique({ where: { id } })
  if (!existing) return { success: false, error: "Тип работы не найден" }

  const patch: {
    displayName?: string
    name?: string
    description?: string | null
    isActive?: boolean
  } = {}

  if (data.displayName !== undefined) {
    const displayName = String(data.displayName).trim()
    if (!displayName) return { success: false, error: "Название не может быть пустым" }
    patch.displayName = displayName
  }
  if (data.description !== undefined) patch.description = data.description?.trim() || null
  if (data.isActive !== undefined) patch.isActive = Boolean(data.isActive)

  if (data.name !== undefined) {
    const name = slugifyDocumentTypeName(data.name)
    if (!name) return { success: false, error: "Некорректный идентификатор типа" }
    const clash = await prisma.documentType.findFirst({ where: { name, NOT: { id } } })
    if (clash) return { success: false, error: "Тип с таким идентификатором уже существует" }
    patch.name = name
  }

  const row = await prisma.documentType.update({ where: { id }, data: patch })
  return { success: true, type: mapRow(row) }
}

export async function deleteDocumentType(id: number): Promise<{ success: boolean; error?: string }> {
  const existing = await prisma.documentType.findUnique({ where: { id } })
  if (!existing) return { success: false, error: "Тип работы не найден" }

  await prisma.documentType.delete({ where: { id } })
  return { success: true }
}
