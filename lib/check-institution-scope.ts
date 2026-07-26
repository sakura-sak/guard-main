import { resolveInstitutionId } from "./directories"
import { isSuperAdmin, isUniversityAdmin } from "./roles"
import type { SessionUser } from "./require-session-api"
import type { StoredUser } from "./user-storage"

export type InstitutionScopeInput = {
  institution?: string | null
  institutionId?: string | null
}

export type InstitutionScopeResult =
  | { ok: true; institutionId: string }
  | { ok: false; error: string; status: number }

async function resolveRequestedInstitutionId(input: InstitutionScopeInput): Promise<string | null> {
  const fromId = input.institutionId?.trim()
  if (fromId) {
    const resolved = await resolveInstitutionId(fromId)
    if (resolved) return resolved
  }
  const fromName = input.institution?.trim()
  if (fromName) return (await resolveInstitutionId(fromName)) || null
  return null
}

/**
 * Resolves institution scope for document check/upload.
 * - University admin: locked to their institution.
 * - Superadmin: must pass institution (selector).
 * - Student/teacher: from profile, optional body fallback.
 */
export async function resolveCheckInstitutionScope(
  user: SessionUser,
  dbUser: StoredUser | null,
  input: InstitutionScopeInput,
): Promise<InstitutionScopeResult> {
  const role = dbUser?.role ?? user.role

  if (isUniversityAdmin(role)) {
    const institutionId = dbUser?.institutionId?.trim() || user.institutionId?.trim() || ""
    if (!institutionId) {
      return { ok: false, error: "У администратора не указано учебное заведение", status: 403 }
    }
    const requested = await resolveRequestedInstitutionId(input)
    if (requested && requested !== institutionId) {
      return {
        ok: false,
        error: "Проверка доступна только в рамках вашего учебного заведения",
        status: 403,
      }
    }
    return { ok: true, institutionId }
  }

  if (isSuperAdmin(role)) {
    const institutionId = await resolveRequestedInstitutionId(input)
    if (!institutionId) {
      return { ok: false, error: "Выберите учебное заведение для проверки", status: 400 }
    }
    return { ok: true, institutionId }
  }

  let institutionId = dbUser?.institutionId?.trim() || user.institutionId?.trim() || ""
  if (!institutionId) {
    institutionId = (await resolveRequestedInstitutionId(input)) || ""
  }
  if (!institutionId && (dbUser?.institution || user.institution)) {
    institutionId = (await resolveInstitutionId(dbUser?.institution || user.institution)) || ""
  }
  if (!institutionId) {
    return {
      ok: false,
      error: "Укажите учебное заведение в профиле перед проверкой",
      status: 400,
    }
  }
  return { ok: true, institutionId }
}
