import type { UserRole } from "./auth"

/** Slug of the default university (BSUIR). */
export const BSUIR_INSTITUTION_ID = "bsuir"
export const BSUIR_INSTITUTION_NAME = "БГУИР"

export function isSuperAdmin(role: UserRole | string | undefined): boolean {
  return role === "superadmin"
}

export function isUniversityAdmin(role: UserRole | string | undefined): boolean {
  return role === "admin"
}

export function isStaffAdmin(role: UserRole | string | undefined): boolean {
  return isSuperAdmin(role) || isUniversityAdmin(role)
}

export function isStudentOrTeacher(role: UserRole | string | undefined): boolean {
  return role === "student" || role === "teacher"
}

export function isBsuirInstitution(institutionId?: string | null, institutionName?: string | null): boolean {
  if (institutionId === BSUIR_INSTITUTION_ID) return true
  if (institutionName && institutionName.trim().toUpperCase() === BSUIR_INSTITUTION_NAME) return true
  return false
}

/** BSUIR accounts: admins may view passwords but not change them via the admin panel. */
export function adminCanChangeUserPassword(
  institutionId?: string | null,
  institutionName?: string | null,
): boolean {
  return !isBsuirInstitution(institutionId, institutionName)
}

/** Roles an actor may assign when creating/updating users. */
export function creatableRolesFor(actorRole: UserRole): UserRole[] {
  if (isSuperAdmin(actorRole)) return ["superadmin", "admin", "teacher", "student"]
  if (isUniversityAdmin(actorRole)) return ["teacher", "student"]
  return []
}

export function canAssignRole(actorRole: UserRole, targetRole: UserRole): boolean {
  return creatableRolesFor(actorRole).includes(targetRole)
}

export type ProfileEditPolicy = {
  institution: boolean
  faculty: boolean
  group: boolean
  fullName: boolean
  email: boolean
}

/** Who may edit which profile fields (student/teacher). */
export function profileEditPolicy(
  role: UserRole | string,
  institutionId?: string | null,
  institutionName?: string | null,
): ProfileEditPolicy {
  if (!isStudentOrTeacher(role)) {
    return { institution: false, faculty: false, group: false, fullName: true, email: true }
  }
  if (isBsuirInstitution(institutionId, institutionName)) {
    return { institution: false, faculty: true, group: true, fullName: false, email: false }
  }
  return { institution: false, faculty: false, group: false, fullName: false, email: false }
}

export function needsProfileCompletion(
  role: UserRole | string,
  institutionId?: string | null,
  institutionName?: string | null,
  faculty?: string | null,
  group?: string | null,
): boolean {
  if (!isStudentOrTeacher(role)) return false
  if (!isBsuirInstitution(institutionId, institutionName)) {
    return !faculty?.trim() || !group?.trim()
  }
  return !faculty?.trim() || !group?.trim()
}
