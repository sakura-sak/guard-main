/**
 * Справочник типов работ (DocumentType) — PostgreSQL (Prisma).
 * Типы привязаны к учебному заведению; управление только superadmin.
 */

import { prisma } from "./prisma"
import { writeAuditLog } from "./audit-log"

export interface DocumentTypeEntry {
  id: number
  institutionId: string
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

function mapRow(row: {
  id: number
  institutionId: string
  name: string
  displayName: string
  description: string | null
  isActive: boolean
}): DocumentTypeEntry {
  return {
    id: row.id,
    institutionId: row.institutionId,
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

async function uniqueSlug(base: string, institutionId: string): Promise<string> {
  let slug = slugifyDocumentTypeName(base)
  let n = 1
  while (
    await prisma.documentType.findUnique({
      where: { institutionId_name: { institutionId, name: slug } },
    })
  ) {
    n += 1
    slug = `${slugifyDocumentTypeName(base)}_${n}`
  }
  return slug
}

async function documentTypeUsage(id: number): Promise<number> {
  return prisma.document.count({ where: { documentTypeId: id } })
}

/** Seed default types for one institution when it has none. */
export async function ensureDocumentTypesForInstitution(institutionId: string): Promise<void> {
  const count = await prisma.documentType.count({ where: { institutionId } })
  if (count > 0) return
  for (const t of DEFAULT_TYPES) {
    await prisma.documentType.create({
      data: {
        institutionId,
        name: t.name,
        displayName: t.displayName,
        isActive: true,
      },
    })
  }
}

async function ensureAllInstitutionsHaveTypes(): Promise<void> {
  const institutions = await prisma.institution.findMany({ where: { isActive: true } })
  for (const inst of institutions) {
    await ensureDocumentTypesForInstitution(inst.id)
  }
}

export async function getAllDocumentTypes(
  includeInactive = false,
  institutionId?: string | null,
): Promise<DocumentTypeEntry[]> {
  await ensureAllInstitutionsHaveTypes()
  const rows = await prisma.documentType.findMany({
    where: {
      ...(includeInactive ? {} : { isActive: true }),
      ...(institutionId ? { institutionId } : {}),
    },
    orderBy: [{ displayName: "asc" }],
  })
  return rows.map(mapRow)
}

export async function getDocumentTypesForInstitution(
  institutionId: string,
  includeInactive = false,
): Promise<DocumentTypeEntry[]> {
  return getAllDocumentTypes(includeInactive, institutionId)
}

export async function getDocumentTypeById(id: number): Promise<DocumentTypeEntry | null> {
  const row = await prisma.documentType.findUnique({ where: { id } })
  return row ? mapRow(row) : null
}

export async function createDocumentType(
  data: {
    institutionId: string
    displayName: string
    name?: string
    description?: string
    isActive?: boolean
  },
  actorUsername?: string,
): Promise<{ success: boolean; error?: string; type?: DocumentTypeEntry }> {
  const institutionId = String(data.institutionId || "").trim()
  if (!institutionId) return { success: false, error: "Укажите учебное заведение" }

  const inst = await prisma.institution.findUnique({ where: { id: institutionId } })
  if (!inst || !inst.isActive) {
    return { success: false, error: "Учебное заведение не найдено" }
  }

  await ensureDocumentTypesForInstitution(institutionId)

  const displayName = String(data.displayName || "").trim()
  if (!displayName) return { success: false, error: "Название типа обязательно" }

  const name = data.name?.trim()
    ? slugifyDocumentTypeName(data.name)
    : await uniqueSlug(displayName, institutionId)

  const existing = await prisma.documentType.findUnique({
    where: { institutionId_name: { institutionId, name } },
  })
  if (existing) {
    if (!existing.isActive) {
      const row = await prisma.documentType.update({
        where: { id: existing.id },
        data: {
          displayName,
          description: data.description?.trim() || null,
          isActive: true,
        },
      })
      await writeAuditLog({
        userId: actorUsername,
        action: "admin_activate_document_type",
        message: `Тип работы активирован (${inst.name}): ${displayName}`,
        entityType: "document_type",
        entityId: row.id,
      })
      return { success: true, type: mapRow(row) }
    }
    return { success: false, error: "Тип с таким названием уже существует в этом УО" }
  }

  const row = await prisma.documentType.create({
    data: {
      institutionId,
      name,
      displayName,
      description: data.description?.trim() || null,
      isActive: data.isActive ?? true,
    },
  })
  await writeAuditLog({
    userId: actorUsername,
    action: "admin_add_document_type",
    message: `Тип работы добавлен (${inst.name}): ${displayName}`,
    entityType: "document_type",
    entityId: row.id,
  })
  return { success: true, type: mapRow(row) }
}

export async function updateDocumentType(
  id: number,
  data: { displayName?: string; name?: string; description?: string; isActive?: boolean },
  actorUsername?: string,
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
  if (data.isActive !== undefined) {
    if (data.isActive === false && existing.isActive) {
      const docs = await documentTypeUsage(id)
      if (docs > 0) {
        return {
          success: false,
          error: `Нельзя деактивировать «${existing.displayName}»: используется в ${docs} докум.`,
        }
      }
    }
    patch.isActive = Boolean(data.isActive)
  }

  if (data.name !== undefined) {
    const name = slugifyDocumentTypeName(data.name)
    if (!name) return { success: false, error: "Некорректный идентификатор типа" }
    const clash = await prisma.documentType.findFirst({
      where: { institutionId: existing.institutionId, name, NOT: { id } },
    })
    if (clash) return { success: false, error: "Тип с таким идентификатором уже существует в этом УО" }
    patch.name = name
  }

  const row = await prisma.documentType.update({ where: { id }, data: patch })
  await writeAuditLog({
    userId: actorUsername,
    action: "admin_update_document_type",
    message: `Тип работы обновлён: ${row.displayName}`,
    entityType: "document_type",
    entityId: id,
  })
  return { success: true, type: mapRow(row) }
}

export async function deactivateDocumentType(
  id: number,
  actorUsername?: string,
): Promise<{ success: boolean; error?: string }> {
  const existing = await prisma.documentType.findUnique({ where: { id } })
  if (!existing) return { success: false, error: "Тип работы не найден" }
  if (!existing.isActive) return { success: true }

  const docs = await documentTypeUsage(id)
  if (docs > 0) {
    return {
      success: false,
      error: `Нельзя деактивировать «${existing.displayName}»: используется в ${docs} докум.`,
    }
  }

  await prisma.documentType.update({ where: { id }, data: { isActive: false } })
  await writeAuditLog({
    userId: actorUsername,
    action: "admin_deactivate_document_type",
    message: `Тип работы деактивирован: ${existing.displayName}`,
    entityType: "document_type",
    entityId: id,
  })
  return { success: true }
}

/** @deprecated Use deactivateDocumentType */
export async function deleteDocumentType(id: number, actorUsername?: string) {
  return deactivateDocumentType(id, actorUsername)
}
