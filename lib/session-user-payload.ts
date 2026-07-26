import type { StoredUser } from "./user-storage"
import {
  canSelfCompleteProfile as checkCanSelfCompleteProfile,
  isBsuirInstitution,
  needsProfileCompletion as checkNeedsProfileCompletion,
  profileEditPolicy,
  type ProfileEditPolicy,
} from "./roles"

export type SessionUserPayload = {
  username: string
  role: string
  additionalRoles?: string[]
  fullName?: string
  email?: string
  institution?: string
  institutionId?: string
  faculty?: string
  group?: string
  isBsuirUser: boolean
  profileEditable: ProfileEditPolicy
  /** Show first-login profile modal (BSUIR students/teachers only). */
  needsProfileCompletion: boolean
  /** Non-BSUIR user missing data set by admin — cannot self-edit. */
  profileBlocked: boolean
  canSelfCompleteProfile: boolean
}

export function buildSessionUserPayload(user: StoredUser): SessionUserPayload {
  const policy = profileEditPolicy(user.role, user.institutionId, user.institution)
  const bsuir = isBsuirInstitution(user.institutionId, user.institution)
  const studentOrTeacher = user.role === "student" || user.role === "teacher"
  const incomplete = checkNeedsProfileCompletion(
    user.role,
    user.institutionId,
    user.institution,
    user.faculty,
    user.group,
  )
  const selfComplete = checkCanSelfCompleteProfile(user.role, user.institutionId, user.institution)
  return {
    username: user.username,
    role: user.role,
    additionalRoles: user.additionalRoles ?? [],
    fullName: user.fullName,
    email: user.email,
    institution: user.institution ?? undefined,
    institutionId: user.institutionId,
    faculty: user.faculty,
    group: user.group,
    isBsuirUser: bsuir,
    profileEditable: policy,
    needsProfileCompletion: incomplete,
    profileBlocked: studentOrTeacher && incomplete && !selfComplete,
    canSelfCompleteProfile: selfComplete,
  }
}
